# Finding out what overwrote a file

Between 2 and 7 September 2026 the same document was reverted five times by
something nobody could name. Three layers of logging were built in response, and
each recorded the effect precisely while naming nobody. This page records what
each layer answers, so the next investigation starts where the last one stopped
rather than repeating it.

## What is already recorded

- **`logs/localfs-writes.log`** — every write and every refusal gmist makes, with
  the bytes written, the bytes that were there before, the version expected and
  the version actually on disk, and the browser that asked. A change with no
  matching line here was not gmist. That is a negative, and a strong one.
- **`logs/snapshots/<file>/`** — every version of every file gmist has open,
  kept fifty deep, whoever wrote it. This is what makes a loss recoverable, and
  it dates the change to under a second.
- **`logs/forensics/<file>-<time>.json`** — written whenever the file changes and
  gmist did not do it. It holds the running processes over the previous fifteen
  seconds, sampled every second, with the ones that appeared inside that window
  listed separately. A `git.exe` or a shell that ran briefly around the moment
  the file moved is named there.

All three use local time with an offset. Do not mix clocks: reading a UTC log
against local file times is what made the first incident note wrong.

## The certain answer, which needs one elevation

The forensic dump names processes that were running. Windows can name the process
that actually performed the write, through object-access auditing. It needs an
administrator once; on this machine that means the `steve` account rather than
`Zoom`.

In an elevated PowerShell:

```powershell
# 1. Turn on auditing for file writes.
auditpol /set /subcategory:"File System" /success:enable

# 2. Audit writes to the one file, by everyone.
$f = "C:\dev\causal-map-extension\rubicon\docs\principles.md"
$acl = Get-Acl $f -Audit
$rule = New-Object System.Security.AccessControl.FileSystemAuditRule(
  "Everyone", "Write,Delete,ChangePermissions", "Success")
$acl.AddAuditRule($rule)
Set-Acl -Path $f -AclObject $acl
```

Then every write appears in the Security log as event 4663, carrying the process
name and id:

```powershell
Get-WinEvent -FilterHashtable @{LogName="Security"; Id=4663} -MaxEvents 40 |
  Where-Object { $_.Message -match "principles" } |
  Select-Object TimeCreated, @{n="Process";e={($_.Message -split "Process Name:\s+")[1] -split "`n" | Select-Object -First 1}}
```

Turn it off afterwards with `auditpol /set /subcategory:"File System" /success:disable`,
since success auditing on a busy volume fills the Security log quickly.

## What actually protects the work

None of the above prevents anything. A commit does: nothing that has destroyed
work here, a `git checkout --`, a session rewind, or a whole-file write from a
stale copy, can reach an object already in git. gmist has a Commit button for
exactly this reason, and it is worth more than all three logs together.
