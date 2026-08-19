import { registerRootComponent } from "expo";
// Added: registers the active-trip background location task before React mounts.
import "./src/services/background-location";
import App from "./App";

registerRootComponent(App);
