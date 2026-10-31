import { Config } from '@remotion/cli/config';

Config.setEntryPoint('src/index.ts');
// the Chrome already on this Mac; Remotion's own browser download is blocked on this network
Config.setBrowserExecutable('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome');
