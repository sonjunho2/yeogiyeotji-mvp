$ErrorActionPreference = "Stop"
$ProjectName = "yeogiyeotji-app"

npx create-expo-app@latest $ProjectName --template blank-typescript
Copy-Item -Force "$PSScriptRoot\App.tsx" ".\$ProjectName\App.tsx"
Set-Location $ProjectName
npx expo install expo-image-picker expo-location react-native-maps @react-native-async-storage/async-storage
Write-Host ""
Write-Host "설치가 끝났습니다. 다음 명령으로 실행하세요:" -ForegroundColor Green
Write-Host "cd $ProjectName"
Write-Host "npx expo start"
