const crypto = require("crypto");
const { URLSearchParams } = require("url");
const { BaseAdapter, createMetric, createAlert } = require("../adapter");
const { safeFetch } = require("../../security/url-validator");

/**
 * AWS CloudWatch adapter — pulls metrics and alarms via the CloudWatch REST API.
 * Implements minimal AWS Signature V4 signing (no aws-sdk dependency).
 */
class CloudWatchAdapter extends BaseAdapter {
  constructor(config) {
    super(config);
    this.name = "cloudwatch";
    this.displayName = "AWS CloudWatch";
    this.pollInterval = config.poll_interval || 60;
  }

  async validateConfig() {
    const errors = [];
    if (!this.config.access_key_id) errors.push("access_key_id is required");
    if (!this.config.secret_access_key) errors.push("secret_access_key is required");
    return { valid: errors.length === 0, errors };
  }

  async testConnection() {
    const start = Date.now();
    try {
      const params = new URLSearchParams({
        Action: "ListMetrics",
        Version: "2010-08-01",
        MaxRecords: "1",
      });

      const res = await this._signedRequest(params);
      return {
        ok: res.ok,
        message: res.ok ? "CloudWatch connection successful" : `HTTP ${res.status}`,
        latencyMs: Date.now() - start,
      };
    } catch (err) {
      return { ok: false, message: err.message, latencyMs: Date.now() - start };
    }
  }

  async pull() {
    const points = [];

    // Pull alarms → alerts
    try {
      const params = new URLSearchParams({
        Action: "DescribeAlarms",
        Version: "2010-08-01",
      });

      const res = await this._signedRequest(params);
      if (res.ok) {
        const text = await res.text();
        const alarms = this._parseAlarms(text);
        for (const alarm of alarms) {
          points.push(
            createAlert(
              this.name,
              "",
              alarm.name,
              alarm.stateValue === "ALARM" ? "critical" : "info",
              this._mapAlarmState(alarm.stateValue),
              null,
            ),
          );
        }
      }
    } catch {
      // Skip alarms on failure
    }

    // Pull key metrics (CPUUtilization, NetworkIn)
    const metricQueries = [
      { namespace: "AWS/EC2", metricName: "CPUUtilization", unit: "percent" },
      { namespace: "AWS/EC2", metricName: "NetworkIn", unit: "bytes" },
      { namespace: "AWS/EC2", metricName: "NetworkOut", unit: "bytes" },
      { namespace: "AWS/EC2", metricName: "DiskReadOps", unit: "count" },
    ];

    for (const mq of metricQueries) {
      try {
        const now = new Date();
        const fiveMinAgo = new Date(now.getTime() - 300000);

        const params = new URLSearchParams({
          Action: "GetMetricStatistics",
          Version: "2010-08-01",
          Namespace: mq.namespace,
          MetricName: mq.metricName,
          StartTime: fiveMinAgo.toISOString(),
          EndTime: now.toISOString(),
          Period: "300",
          "Statistics.member.1": "Average",
        });

        const res = await this._signedRequest(params);
        if (res.ok) {
          const text = await res.text();
          const value = this._parseMetricValue(text);
          if (value !== null) {
            points.push(createMetric(this.name, "", mq.metricName, value, mq.unit, { namespace: mq.namespace }));
          }
        }
      } catch {
        // Skip individual metric on failure
      }
    }

    return points;
  }

  /**
   * Make a signed request to the CloudWatch API using AWS Signature V4.
   */
  async _signedRequest(queryParams) {
    const region = this.config.region || "us-east-1";
    const service = "monitoring";
    const host = this.config.endpoint_url
      ? new URL(this.config.endpoint_url).host
      : `monitoring.${region}.amazonaws.com`;
    const endpoint = this.config.endpoint_url || `https://${host}`;

    const now = new Date();
    const dateStamp = now.toISOString().replace(/[-:]/g, "").slice(0, 8);
    const amzDate = now
      .toISOString()
      .replace(/[-:]/g, "")
      .replace(/\.\d{3}/, "");

    const method = "GET";
    const canonicalUri = "/";
    const canonicalQuerystring = this._sortQueryString(queryParams);

    const signedHeaders = "host;x-amz-date";
    const canonicalHeaders = `host:${host}\nx-amz-date:${amzDate}\n`;

    const payloadHash = crypto.createHash("sha256").update("").digest("hex");

    const canonicalRequest = [
      method,
      canonicalUri,
      canonicalQuerystring,
      canonicalHeaders,
      signedHeaders,
      payloadHash,
    ].join("\n");

    const credentialScope = `${dateStamp}/${region}/${service}/aws4_request`;
    const stringToSign = [
      "AWS4-HMAC-SHA256",
      amzDate,
      credentialScope,
      crypto.createHash("sha256").update(canonicalRequest).digest("hex"),
    ].join("\n");

    const signingKey = this._getSignatureKey(this.config.secret_access_key, dateStamp, region, service);
    const signature = crypto.createHmac("sha256", signingKey).update(stringToSign).digest("hex");

    const authorizationHeader =
      `AWS4-HMAC-SHA256 Credential=${this.config.access_key_id}/${credentialScope}, ` +
      `SignedHeaders=${signedHeaders}, Signature=${signature}`;

    const url = `${endpoint}/?${canonicalQuerystring}`;
    return safeFetch(url, {
      method: "GET",
      headers: {
        "x-amz-date": amzDate,
        Authorization: authorizationHeader,
      },
      signal: AbortSignal.timeout(15000),
    });
  }

  /**
   * Derive the AWS Signature V4 signing key.
   */
  _getSignatureKey(key, dateStamp, region, service) {
    const kDate = crypto.createHmac("sha256", `AWS4${key}`).update(dateStamp).digest();
    const kRegion = crypto.createHmac("sha256", kDate).update(region).digest();
    const kService = crypto.createHmac("sha256", kRegion).update(service).digest();
    const kSigning = crypto.createHmac("sha256", kService).update("aws4_request").digest();
    return kSigning;
  }

  /**
   * Sort query parameters alphabetically (required by Sig V4).
   */
  _sortQueryString(params) {
    const sorted = [...params.entries()].sort((a, b) => a[0].localeCompare(b[0]));
    return sorted.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join("&");
  }

  /**
   * Parse DescribeAlarms XML response into alarm objects.
   */
  _parseAlarms(xml) {
    const alarms = [];
    const memberRegex = /<member>([\s\S]*?)<\/member>/g;
    let match;

    while ((match = memberRegex.exec(xml)) !== null) {
      const block = match[1];
      const name = this._xmlValue(block, "AlarmName") || "Unknown Alarm";
      const stateValue = this._xmlValue(block, "StateValue") || "INSUFFICIENT_DATA";
      alarms.push({ name, stateValue });
    }

    return alarms;
  }

  /**
   * Parse GetMetricStatistics XML response to extract the latest Average value.
   */
  _parseMetricValue(xml) {
    const avg = this._xmlValue(xml, "Average");
    if (avg !== null) return parseFloat(avg);
    return null;
  }

  /**
   * Extract a value from an XML tag.
   */
  _xmlValue(xml, tag) {
    const regex = new RegExp(`<${tag}>([^<]*)</${tag}>`);
    const match = regex.exec(xml);
    return match ? match[1] : null;
  }

  /**
   * Map CloudWatch alarm state to normalized alert status.
   */
  _mapAlarmState(state) {
    const map = {
      OK: "ok",
      ALARM: "firing",
      INSUFFICIENT_DATA: "unknown",
    };
    return map[state] || "unknown";
  }

  static configSchema() {
    return {
      type: "object",
      properties: {
        access_key_id: { type: "string", title: "AWS Access Key ID", description: "IAM access key" },
        secret_access_key: { type: "string", title: "AWS Secret Access Key", description: "IAM secret key" },
        region: {
          type: "string",
          title: "AWS Region",
          description: "AWS region (default: us-east-1)",
          default: "us-east-1",
        },
        endpoint_url: {
          type: "string",
          title: "Custom Endpoint URL",
          description: "Optional custom/proxy endpoint URL",
        },
      },
      required: ["access_key_id", "secret_access_key"],
    };
  }
}

module.exports = CloudWatchAdapter;
