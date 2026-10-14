# How to install The Wise Hive

Takes about 5 minutes. You need a Windows 10 or 11 PC and a Claude account (Pro or Max), and about 550 MB of free disk space (the installer downloads about 150 MB).

## The easy way: ask Claude to do it

1. **Get the Claude desktop app** if you don't have it: download it from [claude.ai/download](https://claude.ai/download) and sign in.
2. **Open the Code tab** in the Claude app and start a new chat. (Pick any folder if it asks; it doesn't matter.)
3. **Paste this message and send it:**

   > Install The Wise Hive from https://github.com/darrenaccount/wise-hive/tree/main/1-wise-hive

4. **Answer Claude's two questions.** It asks where to keep your memory folder (just say "default" for `C:\Users\<you>\ClaudeBrain`), and whether it may install anything that's missing (say yes). It may also ask whether you want training to watch tutorial videos; that's optional.
5. **Approve the command** when Claude asks to run the installer, then wait. Downloading the app takes a few minutes. Claude tells you when it's done.
6. **Start a new chat.** The Wise Hive's memory and skills load when a chat starts, so the chat you installed from won't have them. Try typing `/wise-hive:council` followed by an idea.
7. **Open the app** from the new **The Wise Hive** shortcut on your Desktop or in the Start menu. It also starts with Windows and waits in the tray (bottom-right of the taskbar).

If The Wise Hive chats say "not logged in": open PowerShell, type `claude`, press Enter, and sign in once.

## The manual way

Open **PowerShell** (press Start, type *PowerShell*, press Enter), paste this line, and press Enter:

```powershell
& ([scriptblock]::Create((irm https://raw.githubusercontent.com/darrenaccount/wise-hive/main/1-wise-hive/get.ps1))) -InstallMissing
```

Add `-Brain "D:\MyBrain"` to the end to keep the memory folder somewhere else, or `-WithVideo` to let training watch tutorial videos. When it says **Done**, start a new Claude chat.

## Updating

Run the same thing again (ask Claude "Update The Wise Hive from https://github.com/darrenaccount/wise-hive/tree/main/1-wise-hive", or paste the PowerShell line). Your memories and notes are never overwritten.

## Uninstalling

In PowerShell:

```powershell
powershell -ExecutionPolicy Bypass -File "$env:USERPROFILE\.wise-hive\source\uninstall.ps1"
```

This removes The Wise Hive from Claude and Windows but **keeps your memory folder**. Delete that folder yourself if you want it gone.

## Good to know
- **Your memory folder is private.** It holds your chats and notes. Back it up (OneDrive, a USB stick), but never share or upload it.
- **It uses your Claude usage.** The helper agents are extra Claude runs. On Max, the full edition works best. If you'd rather save usage, you can install [Wise Hive Lite](https://github.com/darrenaccount/wise-hive/tree/main/2-wise-hive-lite) instead. It uses the same memory folder, so you can switch any time.
- **Something went wrong?** Ask Claude: "My The Wise Hive install failed, here's the output:" and paste what the installer printed.
