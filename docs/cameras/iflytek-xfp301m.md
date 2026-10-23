iFlytek XFP301M
===============

Manufactured for iFlytek (科大讯飞), OEM module JXQ03. Runs Thingino.

- Model string (from `/etc/onvif.json`): `iflytek_xfp301m_t31x_jxq03_rtl8188ftv`
- Default hostname: `ing-iflytek-xfp301m-4d1c` (suffix = last 4 hex digits of the wlan0 MAC)

### Hardware

- SoC: Ingenic T31 (XBurst, "Swan"/isvp), kernel 3.10.14__isvp_swan_1.0__ (vendor/iFlytek build)
- Image Sensor: 2MP (1080p)
- Wi-Fi Module: Realtek USB module, USB ID `0bda:f179` (rtl8188fu driver), no Ethernet port (`disable_eth=true` in U-Boot env)
- Flash Chip: NOR 16MB (XM25QH128C, id 0x204018)
  - mtdparts: `256k(boot) 32k(env) 224k(config) 1504k(kernel) 8512k(rootfs) -(rootfs_data)`
  - `config` and `rootfs_data` are jffs2 overlays (`/overlay`, `/opt`)

### Device Unique Identification

Requirement: an identifier that is **immutable by software** and **survives reflashing / factory reset / env wipes**. Values stored in U-Boot env, jffs2 overlays, or any filesystem are excluded by definition (see "Rejected candidates" below).

#### Option A — Wi-Fi module efuse MAC (recommended)

- Factory MAC: `20:ff:36:50:8c:89` (unicast, globally unique)
- Burned into the Realtek module's **hardware efuse (OTP)** at module production. Software cannot rewrite it; it is not in SPI flash, so reflashing firmware, factory reset, or wiping U-Boot env does not affect it.
- Evidence (verified 2026-10):
  - The driver prints the efuse map on every boot (`dmesg | grep -A40 'RTW: HW EFUSE'`); the MAC is burned at efuse offset `0x0D7` (`20 FF 36 50 8C 89`), inside the same programmed region as the USB VID/PID (`DA 0B 79 F1` = `0bda:f179`) and the vendor strings `"Realtek"` / `"802.11n"` — a production efuse map, not a driver default.
  - Value is identical across reboots (verified by reboot test).
  - `20:ff` — the local-administration bit is clear, i.e. a proper factory MAC.

Runtime read (the driver does not expose `perm_addr`, so use one of):

```sh
# 1) wlan1 address with the local-administration bit (0x02) cleared in the FIRST octet
raw=$(cat /sys/class/net/wlan1/address)                  # 22:ff:36:50:8c:89
b1=$(printf '%02x' $(( 0x${raw%%:*} & ~0x02 )))          # 0x22 -> 0x20
mac="$b1:${raw#*:}"                                      # 20:ff:36:50:8c:89

# 2) raw value from the boot log (parse early in boot; the dmesg buffer is recycled later)
dmesg | grep -o 'if1 mac_addr=[0-9a-f:]*' | cut -d= -f2
```

Residual risk: changes only if the Wi-Fi module is physically replaced (not expected on an integrated module). Production uniqueness across units should be confirmed by comparing a second device.

#### Option B — USB module serial number

- Value on the reference unit: `00e04c000001` (production-programmed, format `00e04c` + unit counter)

```sh
cat /sys/bus/usb/devices/1-1/serial
```

- Same guarantees as Option A: burned at module production, verified stable across reboots, unaffected by reflashing.
- Independent source from the MAC — usable for cross-validation.

#### Combining A + B

Read both values from hardware on demand and hash them; nothing is persisted to flash, which preserves both guarantees:

```sh
uid=$(printf '%s%s' "$mac" "$(cat /sys/bus/usb/devices/1-1/serial)" | sha256sum | cut -c1-16)
```

#### Option C (not usable without firmware work) — SoC efuse chip ID

The T31 efuse controller driver is disabled in this project's kernel configs (`# CONFIG_JZ_EFUSE_V13 is not set` in `board/ingenic/xburst1/kernel/{3.10,6.11}/t31.generic.config`); `/proc/iomem` shows no efuse region and `/sys/class` has no efuse node. Enabling it would expose a SoC-level ID (surviving even a Wi-Fi module swap), but requires the iFlytek vendor kernel (`3.10.14__isvp_swan_1.0__`) to be rebuilt with the driver, plus verification that a unique chip ID is actually burned on this silicon.

### Rejected candidates

| Candidate | Value on reference unit | Reason |
|---|---|---|
| U-Boot env `wlan_mac` | `02:3f:e2:58:4d:1c` | `fw_setenv` can change it; lost if env is wiped or a generic image is flashed |
| U-Boot env `ethaddr` | `02:3f:e2:58:4d:1b` | Same as above (no Ethernet port on this unit; env value only) |
| `onvif.json` `camera.serial_num` | `023fe2584d1b` | Just a copy of the env MAC, plain overlay file |
| Any `/overlay` file (SSH host keys, `thingino.json`, ...) | — | Lost on factory reset / reflash |
| Flash chip ID | `0x204018` (XM25QH128C) | Identical across all units of the model |
| `/proc/cpuinfo` Serial | all zeros | Not programmed |

### Notes

- MAC assignment chain at boot: `/etc/network/if-pre-up.d/set_mac_address` applies `jct /etc/thingino.json get wlan.mac` (falling back to `fw_printenv -n wlan_mac`) to `wlan0`; the hostname suffix is derived from the same value (`/etc/init.d/S04hostname`). These env/file values are for display and networking only — do not use them as the device unique ID.
- SSH access for analysis: `root@192.168.31.175`.
