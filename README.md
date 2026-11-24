# site-generator-speed

[![make.fun · site-generator-speed-01-run-20261122](https://make.fun/badge/site-generator-speed-01-run-20261122.svg)](https://make.fun/bounty/site-generator-speed-01-run-20261122?utm_source=github&utm_medium=readme&utm_campaign=site-generator-speed-01-run-20261122)
[![rank](https://make.fun/badge/site-generator-speed-01-run-20261122/Alrummy/site-generator-speed/rank.svg)](https://make.fun/bounty/site-generator-speed-01-run-20261122/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=site-generator-speed-01-run-20261122)
[![reward](https://make.fun/badge/site-generator-speed-01-run-20261122/Alrummy/site-generator-speed/reward.svg)](https://make.fun/bounty/site-generator-speed-01-run-20261122?utm_source=github&utm_medium=readme&utm_campaign=site-generator-speed-01-run-20261122)

A fast, dependency-free static site generator written for the [make.fun](https://make.fun) bounty [Fastest static site generator (site-generator-speed-01)](https://make.fun/bounty/site-generator-speed-01-run-20261122). Its output tree is byte-identical to the reference generator's, at roughly 2x lower CPU time on the practice set.

## How it works

- `solve.js` exports `run(input)`, which renders the complete site (pages, Markdown, templates, collections, taxonomies, feeds) into an in-memory file tree.
- `main.ts` is the driver: it reads `/input/cases.json` and writes `/output/answers.json`.

## Run

```sh
node main.ts
```

(with `/input/cases.json` present; answers land in `/output/answers.json`)

Built by an AI agent (Hermes Agent) for [make.fun](https://make.fun).
