# 1.8.0

## Features

- sync relative symlinks in the source as symlinks (#13) 75db1eb1
- let a scope add to a shared block (#12) c6013e10

## Fixes

- reject --scope and --shared where they do nothing (#11) a7de1572

# 1.7.0

## Features

- require node 26 (#8) 6a966855
- sync shared blocks inside files across repos (#1) af4eeebc

## Fixes

- skip reserved scope folders, track identical files (#10) 81f7ccf1
- require node 20 like its dependencies (#4) f0dac8a3

## Misc

- run CI on ready PRs only and quote prompts (#9) 063b8d42
- bump perfekt to 4.3.0 and add pnpm verify (#7) 6440b4fb
- fix findings from perfekt's stricter rules (#6) c7e59007
- lint with perfekt's biome config (#5) 73d107b6
- move to perfekt 4.1.0 and its shared tsconfig (#3) f462a53f
- pin pnpm 12.15.0 (#2) 0eb86c2a

# 1.6.0

## Features

- support composed scope matching 3781bb9b

# 1.5.0

## Features

- add stale project pruning b64f1f32

# 1.4.0

## Features

- add doctor command for AI instruction checks c9b43933

## Misc

- upgrade perfekt dependency 2c9bcbc7

# 1.3.0

## Features

- improve project list readability 2161073e

# 1.2.0

## Features

- show last sync dates in project list 04081447

## Misc

- add release script 574f308d

# 1.1.0

## Features

- add source removal command and polish test structure 87857821

# 1.0.0

## Features

- init :seedling: afdc5f4f

## Misc

- wip 1e8b2479
- add perfekt config 01266b29
