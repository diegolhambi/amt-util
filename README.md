# amt-util

> *Simple, Unix-style CLI tool for Intel Active Management Technology (AMT) remote power control and hardware inventory.*

[![License: ISC](https://img.shields.io/badge/License-ISC-blue.svg)](./LICENSE)
[![Node.js](https://img.shields.io/badge/Node.js-%3E%3D18.0.0-green.svg)](https://nodejs.org)


## Highlights

- **Power Cycle Control**: Turn on, force off, power cycle, hard reset, and graceful shutdown (via Intel MEI ACPI).
- **Selectable Boot Target**: Boot into `normal`, `hdd`, or `cd/dvd` on power commands.
- **Hardware Scraping**: Extract system info, BIOS version, CPU details, RAM modules, and dynamic storage devices.
- **OS Boot Detection (`wait-os`)**: Block execution until the OS and Intel MEI driver finish booting.
- **Unix Philosophy**: Composable, pipe-friendly (`grep`, `awk`, `jq`), with `--quiet` and `--json` support.
- **Direct WebUI Integration**: Works seamlessly when AMT WS-Management (WS-MAN / SOAP) is disabled, broken, or deprecated.


## Overview

Intel Active Management Technology (AMT) provides powerful out-of-band management. However, in many firmware versions and environments, modern WS-Management (WS-MAN) APIs and SOAP endpoints are deprecated, complex, or fail to connect.

`amt-util` solves this by interacting directly with the built-in Intel AMT WebUI. It automatically handles HTTP Digest authentication, CSRF tokens, session handshakes, and extracts clean, machine-readable data.


## Usage

`amt-util` is designed to be concise and script-friendly.

### Quick status check

```bash
# Human-readable status
amt-util status

# Quiet mode (prints only 'On' or 'Off' for conditional scripts)
amt-util status -q

# JSON output
amt-util status --json
```

### Power management

```bash
# Turn machine on
amt-util power on

# Graceful shutdown (ACPI signal to OS)
amt-util power shutdown

# Force power off or hard reset
amt-util power off
amt-util power reset

# Power cycle with boot override
amt-util power cycle --boot cd
```

### Hardware inventory

```bash
# Inspect all hardware components
amt-util hwinfo

# Filter by category (system, processor, memory, disk)
amt-util hwinfo disk

# JSON export for monitoring and inventory pipelines
amt-util hwinfo --json | jq '.disk'
```

### Chaining & Automations (`wait-os`)

`wait-os` blocks until the machine is booted and the OS Intel MEI driver registers readiness with AMT:

```bash
# Power on, wait until OS is ready, then query hardware
amt-util power on && amt-util wait-os -q && amt-util hwinfo
```


## Installation

```bash
git clone https://github.com/your-username/amt-control.git
cd amt-control
npm install
npm link
```

### Requirements

- **Node.js**: `>= 18.0.0` (Native ECMAScript Modules)
- **Intel AMT Device**: WebUI accessible on port `16992` (HTTP) or `16993` (HTTPS)


## Configuration

Credentials can be passed via config file, environment variables, or CLI flags.

### Config file (Recommended)

Create `~/.config/amt-util/config` (or `.amtrc` in your current directory):

```ini
host=192.168.15.200
pass=your-amt-password
# Optional overrides (defaults shown):
# user=admin
# port=16992
```

Secure the file permissions:
```bash
chmod 600 ~/.config/amt-util/config
```

### Environment variables

```bash
export AMT_HOST="192.168.15.200"
export AMT_PASS="your-amt-password"
```

### Global CLI flags

```bash
amt-util --host 192.168.15.200 --pass "your-amt-password" status
```


## Tested Environments

- **Intel AMT Firmware**: `11.8.92-build 4222` (Intel ME 11.8)
- **Target Device**: Dell OptiPlex 7040 (Intel Core i5-6500T)
- **Operating System**: Windows 10/11 with Intel MEI driver (for ACPI graceful shutdown)


## Feedback and Contributing

If you encounter issues, firmware incompatibilities, or have feature suggestions:

- Open an issue on [GitHub Issues](https://github.com/your-username/amt-control/issues).
- Pull requests and testing with other AMT firmware versions are welcome!


## License

This project is licensed under the [ISC License](./LICENSE).
