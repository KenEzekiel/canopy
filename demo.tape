# Canopy Deploy Demo — meshterm.live
# Run from: ~/Documents/Repositories/meshterm-landing

Output demo.gif
Output demo.mp4

Set Shell "bash"
Set FontSize 15
Set Width 1100
Set Height 650
Set Theme "Catppuccin Mocha"
Set Padding 16
Set TypingSpeed 50ms
Set PlaybackSpeed 1.5

# Show what we're deploying
Type "ls"
Enter
Sleep 1.5s

Type "head -5 index.html"
Enter
Sleep 2s

# Scan
Type "npx canopy-deploy scan"
Enter
Sleep 6s

# Deploy with custom domain
Type "npx canopy-deploy deploy --name meshterm-landing --domain meshterm.live --server 65.109.174.109 --verbose"
Enter
Sleep 45s

# Verify
Type "curl -s -o /dev/null -w 'HTTP %{http_code}' https://meshterm.live/ && echo ''"
Enter
Sleep 3s

# SSH
Type "# SSH into the server: npx canopy-deploy ssh meshterm-landing"
Enter
Sleep 3s
