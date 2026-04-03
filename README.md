# @gibme/mikrotik

A TypeScript helper/wrapper for managing MikroTik RouterOS devices over SSH.

## Documentation

[https://gibme-npm.github.io/mikrotik/](https://gibme-npm.github.io/mikrotik/)

## Requirements

- Node.js >= 22

## Installation

```bash
npm install @gibme/mikrotik
```

```bash
yarn add @gibme/mikrotik
```

## Usage

```typescript
import Mikrotik from '@gibme/mikrotik';

const device = new Mikrotik({
    host: '192.168.1.1',
    username: 'admin',
    password: 'password'
});

await device.connect();

const identity = await device.identity();
console.log(`Connected to: ${identity}`);

const routes = await device.get_ip_routes();
console.log(`Route count: ${routes.length}`);

await device.destroy();
```

## API

### Connection

| Method | Description |
|--------|-------------|
| `connect()` | Connects to the device over SSH |
| `destroy()` | Closes the SSH connection and stops internal timers |

### Device Information

| Method | Return Type | Description |
|--------|-------------|-------------|
| `identity()` | `string` | Device identity name |
| `version()` | `string` | RouterOS version string |
| `semantic_version()` | `{major, minor, patch}` | Parsed semantic version |
| `routerboard()` | `Mikrotik.Response.Routerboard` | Board info (model, firmware, serial) |
| `resource()` | `Mikrotik.Response.Resource` | System resources (CPU, memory, uptime) |
| `health()` | `Mikrotik.Response.V6.Health \| V7.Health` | Temperature, voltage, fan data (version-aware) |

### Networking

| Method | Return Type | Description |
|--------|-------------|-------------|
| `get_interfaces(active_only?)` | `Mikrotik.Response.Interface[]` | Network interfaces with tunnel details |
| `get_ip_addresses(active_only?)` | `Mikrotik.Response.Address[]` | IP addresses assigned to interfaces |
| `get_ip_routes(min_distance?, vrf?, active_only?)` | `Mikrotik.Response.Route[]` | Routing table entries |
| `get_route_counts(min_distance?, vrf?)` | `Record<string, Route.Count>` | Route counts per IP with active marking |
| `ping(target, source?)` | `Mikrotik.Response.Ping` | Ping with latency measurement |
| `traceroute(target, source?)` | `Mikrotik.Response.Traceroute[]` | Traceroute with reverse DNS on hops |

### Bandwidth Testing

```typescript
const result = await device.bandwidth_test(
    'target-host',
    'username',
    'password',
    {
        duration: 10,
        direction: 'both',
        protocol: 'udp',
        callback: (update) => {
            console.log(`${update.status}: ${update.transmit?.current} bps`);
        }
    }
);
```

Supports `AbortSignal` for cancellation and real-time progress via callback.

### Raw Commands

| Method | Description |
|--------|-------------|
| `terse<Type>(command)` | Execute a command and parse terse (space-separated key=value) output |
| `kvs<Type>(command)` | Execute a command and parse colon-separated key-value output |

## License

MIT
