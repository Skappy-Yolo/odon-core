// Outbound integrations: Google Calendar (free/busy), Microsoft Graph,
// iCloud CalDAV, Google Places. Default OAuth scope is `calendar.freebusy`.
// Anything broader requires the explicit `/autoadd on` opt-in flow.
export {
  GoogleCalendarProvider,
  GoogleNotConnectedError,
  GoogleReauthRequiredError,
} from "./google-calendar.js";
export type { GoogleCalendarProviderOptions } from "./google-calendar.js";
