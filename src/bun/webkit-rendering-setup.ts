// Imported first by index.ts, so the variables are in place before
// Electrobun's native wrapper starts GTK and WebKitGTK reads them.
import { settingsFilePath } from "./settings";
import { setUpRendering } from "./webkit-rendering";

/** What was decided about WebKitGTK's renderer for this run, for Settings. */
export const renderingAtStart = setUpRendering(settingsFilePath());
