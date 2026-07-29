#!/usr/bin/env bash
set -euo pipefail
PROJECT_NAME="yeogiyeotji-app"
npx create-expo-app@latest "$PROJECT_NAME" --template blank-typescript
cp "$(dirname "$0")/App.tsx" "$PROJECT_NAME/App.tsx"
cd "$PROJECT_NAME"
npx expo install expo-image-picker expo-location react-native-maps @react-native-async-storage/async-storage
echo "설치 완료: cd $PROJECT_NAME && npx expo start"
