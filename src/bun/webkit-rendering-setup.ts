// Imported first by index.ts, so the variables are in place before
// Electrobun's native wrapper starts GTK and WebKitGTK reads them.
import { applyWebkitRendering, webkitRenderingVariables } from "./webkit-rendering";

applyWebkitRendering(webkitRenderingVariables(process.platform, process.env));
