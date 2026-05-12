# # Write-Host "🔍 Searching for package.json files..."

# # Get-ChildItem -Recurse -Filter package.json | 
# # Where-Object { $_.FullName -notmatch "node_modules" } | 
# # ForEach-Object {
    
# #     $dir = $_.DirectoryName
# #     Write-Host "📦 Updating dependencies in $dir"
    
# #     Push-Location $dir
# #     npm update
# #     Pop-Location
# # }

# # Write-Host "✅ All packages updated (within version ranges)."

# Write-Host "🚀 Searching for package.json files..."

# Get-ChildItem -Recurse -Filter package.json | 
# Where-Object { $_.FullName -notmatch "node_modules" } | 
# ForEach-Object {

#     $dir = $_.DirectoryName
#     Write-Host "⬆ Upgrading dependencies in $dir"
    
#     Push-Location $dir
#     npx npm-check-updates -u
#     npm install
#     Pop-Location
# }

# Write-Host "🔥 All packages upgraded to latest versions."

Write-Host "Searching for package.json files..."

Get-ChildItem -Recurse -Filter package.json -ErrorAction SilentlyContinue | 
Where-Object { $_.FullName -notmatch "node_modules" } | 
ForEach-Object {

    $dir = $_.DirectoryName
    Write-Host "Upgrading dependencies in $dir"
    
    Push-Location $dir
    npx npm-check-updates -u
    npm install
    # npm install --legacy-peer-deps
    Pop-Location
}

Write-Host "All packages upgraded to latest versions."