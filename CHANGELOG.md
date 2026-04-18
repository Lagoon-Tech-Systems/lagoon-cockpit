# Changelog

## [2.1.0](https://github.com/Lagoon-Tech-Systems/lagoon-cockpit/compare/v2.0.0...v2.1.0) (2026-04-18)


### Features

* add app screenshots, fix ContainerCard web nesting, update launch content ([5e8d8e9](https://github.com/Lagoon-Tech-Systems/lagoon-cockpit/commit/5e8d8e9b7236e6286cc8f179616e86c7cfae3244))
* add demo GIF to README ([9ae1c45](https://github.com/Lagoon-Tech-Systems/lagoon-cockpit/commit/9ae1c45bf583e87c9803da69c5e0be41fe095947))
* add Pro module UI screens and API extensions ([8eccbe6](https://github.com/Lagoon-Tech-Systems/lagoon-cockpit/commit/8eccbe697a18549095c71f425bf9994a8b73b812))
* **app:** add PWA support + web deployment config ([02c473e](https://github.com/Lagoon-Tech-Systems/lagoon-cockpit/commit/02c473e2df49b34c0e70983c7ea617edcfe83ddd))


### Bug Fixes

* correct license from MIT to AGPL-3.0 in launch Dev.to article ([c90700e](https://github.com/Lagoon-Tech-Systems/lagoon-cockpit/commit/c90700e79b84d589ed20b0079be941e709a6216b))
* correct license from MIT to AGPL-3.0 in launch LinkedIn post ([c10b491](https://github.com/Lagoon-Tech-Systems/lagoon-cockpit/commit/c10b491c561778abc1c2b2533c08d2891842761c))
* correct license to AGPL-3.0, redact real stack names from content Dev.to article ([5b36924](https://github.com/Lagoon-Tech-Systems/lagoon-cockpit/commit/5b3692430f56363c96951b72a4db9cb110eafa0a))
* correct license to AGPL-3.0, remove MT5 trading reference from content LinkedIn post ([e27783c](https://github.com/Lagoon-Tech-Systems/lagoon-cockpit/commit/e27783cf585816e46cc2532ee3892c33882cc296))

## [2.0.0](https://github.com/Lagoon-Tech-Systems/lagoon-cockpit/compare/v1.0.0...v2.0.0) (2026-03-30)


### ⚠ BREAKING CHANGES

* Pro and Enterprise mobile screens removed from CE public repo. These now live exclusively in the private cockpit-pro repository. CE manage menu shows only CE features (14 items).

### Features

* **app:** add 11 Pro mobile screens + fix API paths and FeatureGate coverage ([0c4a207](https://github.com/Lagoon-Tech-Systems/lagoon-cockpit/commit/0c4a2077165e8623a63fd4377aed70498c368373))
* **app:** add 19 Enterprise mobile screens, migrate animations to Reanimated v4 ([3f0d670](https://github.com/Lagoon-Tech-Systems/lagoon-cockpit/commit/3f0d6707c1ec4ff375f48c26d34da6f8e5ce499b))
* Pro UI — incidents management + auto-remediation screens ([16ebefb](https://github.com/Lagoon-Tech-Systems/lagoon-cockpit/commit/16ebefb44311ecacd616c2c3877f0fe8b6b8bbcb))
* publish lagoon-cockpit-cli to npm, enable CI publish job ([5043143](https://github.com/Lagoon-Tech-Systems/lagoon-cockpit/commit/504314335a9073d855b79be205c9c25b0709bb05))
* separate CE and Pro editions, rotate all secrets ([33a8716](https://github.com/Lagoon-Tech-Systems/lagoon-cockpit/commit/33a87164570897d9d510c8b5b75a26db0c3be91a))


### Bug Fixes

* **app:** resolve Reanimated AnimatedStyle type mismatch in Skeleton ([2f07d43](https://github.com/Lagoon-Tech-Systems/lagoon-cockpit/commit/2f07d43f37b88c65d0ac9d8692b90532ece2fe93))
* **app:** resolve Skeleton style type mismatch for Reanimated ([4c65f51](https://github.com/Lagoon-Tech-Systems/lagoon-cockpit/commit/4c65f5192d22d81fefe8e0e8c2c4352c38f50a93))
* **app:** sanitize error messages, complete Reanimated v4 migration, wire compliance nav + IP edit ([b79db89](https://github.com/Lagoon-Tech-Systems/lagoon-cockpit/commit/b79db894b3292955115face8e1edf9437c217b8c))
