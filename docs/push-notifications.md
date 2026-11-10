# Phone notifications

The desktop already shows a banner when an agent needs you. The companion app can pick up the ones you miss.

## How it decides

The phone is a second chance, not a mirror. Mirroring every banner means a buzz in your pocket for the notification you just read at your desk, which trains you to swipe the phone one away unread, which kills the only case that matters.

So a notification reaches your phone only when you missed it, and missing it has one definition: the desktop window was never in front with that tab open during the grace window. Nothing else counts as evidence, because nothing else proves you read it.

Three things can happen when an agent needs you:

| At that moment | What you get |
|---|---|
| The desktop is in front and you are on that tab | Nothing. You are looking at it. |
| The banner fires and you open that tab within the wait | The desktop banner only. The phone stays quiet. |
| The banner fires and you never come | The phone buzzes, once the wait is up. |

The wait defaults to three minutes, because you can be at your desk and heads-down in another window for a while. You can change it, from "right away" to half an hour, in the app.

Just before it sends, the desktop checks the tab again. If the agent has moved on, or you answered the prompt from your phone, nothing is sent: a notification about something that already resolved is worse than none.

## Settings live on the phone

There is no notification settings screen on the Mac, and there does not need to be. Desktop notifications stay on. Everything about phone notifications is in the companion app, under the bell in the sessions sheet, because your phone is the thing that buzzes.

Each paired phone keeps its own settings. Two phones on one Mac can want different waits.

## What leaves your network

Terminal output and keystrokes never leave your local network. That has not changed.

Notification text does. A phone that is asleep in your pocket cannot be reached over Wi-Fi, so the notification travels through Expo's push service and then Apple's or Google's, the same path every app's notifications take. That is why the switch is off until you turn it on, and why turning it on tells you so.

If you want the nudge without the nouns, turn on **Hide project and tab names**. The notification then says an agent needs you, without saying which one, and tapping it still opens the right terminal.

Every notification carries a signature made with a key your Mac and your phone worked out when you paired them, and neither ever sends it anywhere. The signature covers which desktop a notification claims to come from and which terminal tapping it opens, so one that fails the check takes you nowhere: the tap does nothing.

What it cannot cover is the words. Your phone draws the title and body itself, before the app is allowed to look at them, on both iOS and Android. So someone who got hold of your push token could make text appear under this app's name. They could not make it open one of your terminals, and they could not read anything from your Mac. Putting the text somewhere the app can check it before your phone draws it is a separate piece of work, and is not in this version.

## Tapping one

A tap opens the terminal that raised it. If it came from a desktop you are not currently connected to, the app switches to that desktop first.

## Setup for maintainers

Push needs credentials that cannot live in the repo.

1. **Expo project id.** `getExpoPushTokenAsync` refuses to run without one. Set `EAS_PROJECT_ID` in the environment for local builds and as a repository secret for CI. A build without it still runs; the settings screen reports push as unavailable instead of the app failing.
2. **Android, FCM.** Upload the Firebase service account key with `eas credentials`, then provide `google-services.json`. It carries a cloud project identifier, so it is gitignored and CI writes it from the `GOOGLE_SERVICES_JSON_BASE64` secret. The Android release build fails loudly when that secret is missing rather than producing a build where push silently never registers. A build without the file leaves the Firebase config out of the Android project altogether, so it still builds and push simply never registers on it.
3. **iOS, APNs.** A paid Apple Developer account and an APNs key uploaded with `eas credentials`. The blocked-agent notification uses the time-sensitive interruption level so it can break through Focus, which needs the Time Sensitive Notifications capability on the App ID.

None of this is needed to build or run the apps. Without it, push reports itself unavailable and everything else works as before.
