import * as fs from 'fs';
import * as path from 'path';

const appDir = path.resolve(__dirname, '..', '..', 'app', '(tabs)');
const manageSrc = fs.readFileSync(path.join(appDir, 'manage.tsx'), 'utf8');
const layoutSrc = fs.readFileSync(path.join(appDir, '_layout.tsx'), 'utf8');

/** Returns the text of the <Tabs.Screen ... /> element whose name is `name`. */
function screenBlock(src: string, name: string): string {
  const start = src.indexOf(`name="${name}"`);
  if (start === -1) throw new Error(`Tabs.Screen "${name}" not found`);
  const open = src.lastIndexOf('<Tabs.Screen', start);
  const end = src.indexOf('/>', start);
  // options={{ ... }} contains no self-closing tags other than the icon JSX,
  // so walk to the closing "/>" that follows the options object.
  const optionsEnd = src.indexOf('}}', start);
  const close = src.indexOf('/>', optionsEnd);
  return src.slice(open, (close === -1 ? end : close) + 2);
}

describe('public navigation', () => {
  it.each(['/manage/kaizen-audits', '/manage/sentinel-live', '/manage/web-metrics'])(
    'manage.tsx has no row for %s',
    (route) => {
      expect(manageSrc).not.toContain(route);
    },
  );

  it('hides the monitoring tab from the tab bar', () => {
    const block = screenBlock(layoutSrc, 'monitoring');
    expect(block).toContain('href: null');
    expect(block).not.toContain('tabBarIcon');
  });

  it('does not title any tab "Monitoring"', () => {
    expect(layoutSrc).not.toMatch(/title:\s*['"]Monitoring['"]/);
  });
});
