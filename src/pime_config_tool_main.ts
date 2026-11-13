/**
 * Entry point of output/pime/config_tool.js: `node config_tool.js [page]`.
 * The input method starts it when the user opens the settings, user phrases
 * or help page.
 */
import { runConfigTool } from "./pime_config_tool";

runConfigTool(process.argv[2], __dirname);
