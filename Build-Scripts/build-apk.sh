#!/usr/bin/env bash
# Builds the DANI OS Mobile debug APK. Requires JDK 17 and the Android SDK (ANDROID_HOME or ANDROID_SDK_ROOT),
# plus Gradle (system `gradle`) — or generate a wrapper once with: cd Mobile-App && gradle wrapper
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SDK="${ANDROID_HOME:-${ANDROID_SDK_ROOT:-}}"
[ -n "$SDK" ] && [ -d "$SDK/platforms" ] || { echo "Android SDK not found. Install it (Android Studio, or cmdline-tools + 'sdkmanager \"platforms;android-34\" \"build-tools;34.0.0\"') and set ANDROID_HOME."; exit 1; }
cd "$ROOT/Mobile-App"
echo "sdk.dir=$SDK" > local.properties
if [ -x ./gradlew ]; then ./gradlew assembleDebug; else gradle assembleDebug; fi
mkdir -p "$ROOT/Mobile-App/out"
cp app/build/outputs/apk/debug/app-debug.apk "$ROOT/Mobile-App/out/DANI-OS-Mobile-0.1.18-debug.apk"
echo "Done: Mobile-App/out/DANI-OS-Mobile-0.1.0-debug.apk"
