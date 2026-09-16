// Runs in the browser before the app hydrates, so errors from the first render are caught too.
import { startTelemetry } from "@/lib/telemetry";

startTelemetry();
