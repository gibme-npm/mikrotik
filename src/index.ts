// Copyright (c) 2024, Brandon Lehmann <brandonlehmann@gmail.com>
//
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
//
// The above copyright notice and this permission notice shall be included in all
// copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
// SOFTWARE.

import SSH, { AbortController, AbortSignal } from '@gibme/ssh';
import { BandwidthTest, CommandResponses, Response } from './types';
import { Address4 } from 'ip-address';
import Cache from '@gibme/cache/memory';
import { reverse } from 'dns';
import { coerce, valid } from 'semver';
export { AbortController, AbortSignal };

export type { ConnectConfig } from '@gibme/ssh';

export type Direction = BandwidthTest.Direction;
export type Protocol = BandwidthTest.Protocol;
export type Status = BandwidthTest.Status;
export type Update = BandwidthTest.Update;
export type Options = BandwidthTest.Options;

export type Address = Response.Address;
export type Interface = Response.Interface;
export type Tunnel = Response.Tunnel;
export type Route = Response.Route;
export type RouteCount = Response.RouteCount;
export type Ping = Response.Ping;
export type Traceroute = Response.Traceroute;
export type RouterBoard = Response.Routerboard
export type Resource = Response.Resource;
export type Health = Response.Health;

/** @ignore */
const toVersion = (version: string) => valid(coerce(version)) || version;

/** @ignore */
const toIP4 = (address: string) => {
    try {
        return new Address4(address);
    } catch {
        return undefined;
    }
};

export default class Mikrotik extends SSH {
    protected static cache: Cache = new Cache({
        stdTTL: 15,
        checkperiod: 17
    });

    /**
     * Retrieves the routes in the routing table
     *
     * @param min_distance
     * @param vrf
     * @param active_only
     */
    public async get_ip_routes (
        min_distance = 0,
        vrf?: string,
        active_only = true
    ): Promise<Route[]> {
        const [ifaces, ips] = await Promise.all([
            this.get_interfaces(),
            this.get_ip_addresses()
        ]);

        const command = `/ip route print terse without-paging${active_only ? ' where active' : ''}`;

        const routes = await this.terse<CommandResponses.Route>(command);

        return routes.map(route => {
            const _network = route['dst-address'].split('/');
            const address = _network[0];
            const cidr = parseInt(_network[1]);
            const [gateway, iface] = (() => {
                if (!route.gateway) return [undefined, undefined];

                const gw = toIP4(route.gateway);

                if (route.gateway.includes('%')) {
                    const [gateway, ...iface] = route.gateway.split('%');

                    return [gateway, iface.join('%')];
                } else if (gw) {
                    const ip = ips.filter(ip => ip.includes(route.gateway)).shift();

                    return [route.gateway, ip?.iface];
                } else {
                    const ip = ips.filter(ip => ip.iface === route.gateway).shift();

                    return [ip?.ipaddress, route.gateway];
                }
            })();
            const distance = parseInt(route.distance);
            const scope = parseInt(route.scope);
            const target_scope = parseInt(route.target_scope) || undefined;

            // this does not account for if a device has multiple addresses in the same network
            const preferred_source = ips.filter(ip => gateway ? ip.includes(gateway) : false).shift()?.ipaddress;
            const _vrf = route['routing-table'] || route['routing-mark'] || 'main';

            const tunnel: Tunnel | undefined = (() => {
                const tunnel = ifaces.filter(_iface => _iface.name === iface).shift();
                const parent = ips.filter(ip => ip.ipaddress === tunnel?.local_address).shift();

                if (!tunnel || !parent) return undefined;

                return {
                    ...tunnel,
                    parent
                };
            })();

            const result: Route = {
                network: address,
                cidr,
                distance,
                scope,
                vrf: _vrf,
                includes: (ipaddress: string): boolean => {
                    const temp_address = toIP4(ipaddress);
                    const temp_network = toIP4(`${address}/${cidr}`);

                    if (!temp_address || !temp_network) return false;

                    return temp_address.isInSubnet(temp_network);
                }
            };

            if (preferred_source) result.preferred_source = preferred_source;
            if (gateway) result.gateway = gateway;
            if (iface) result.iface = iface;
            if (tunnel) result.tunnel = tunnel;
            if (target_scope) result.target_scope = target_scope;
            if (route.comment) result.comment = route.comment;

            return result;
        })
            .filter(route => route.distance >= min_distance)
            .filter(route => vrf ? route.vrf === vrf : true);
    }

    /**
     * Retrieves the IP addresses active on the system
     *
     * @param active_only
     */
    public async get_ip_addresses (
        active_only = true
    ): Promise<Address[]> {
        const command = `/ip address print terse without-paging${active_only ? ' where !disabled' : ''}`;

        const addresses = await this.terse<CommandResponses.Address>(command);

        return addresses.map(line => {
            const _address = line.address.split('/');
            const ipaddress = _address[0];
            const cidr = parseInt(_address[1]);

            const result: Address = {
                ipaddress,
                network: line.network,
                cidr,
                iface: line.interface,
                includes: (ipaddress: string): boolean => {
                    const temp_address = toIP4(ipaddress);
                    const temp_network = toIP4(`${line.network}/${cidr}`);

                    if (!temp_address || !temp_network) return false;

                    return temp_address.isInSubnet(temp_network);
                }
            };

            if (line.comment) result.comment = line.comment;

            return result;
        });
    }

    /**
     * Retrieves the interfaces active on the system
     *
     * @param active_only
     */
    public async get_interfaces (active_only = true): Promise<Interface[]> {
        const filter = active_only ? ' where !disabled' : '';

        const [ifaces, gre, ipip, eoip] = await Promise.all([
            this.terse<CommandResponses.Interface>(
                `/interface print terse without-paging${filter}`),
            this.terse<CommandResponses.TunnelInterface>(
                `/interface gre print terse without-paging${filter}`),
            this.terse<CommandResponses.TunnelInterface>(
                `/interface ipip print terse without-paging${filter}`),
            this.terse<CommandResponses.TunnelInterface>(
                `/interface eoip print terse without-paging${filter}`)
        ]);

        const tunnels: CommandResponses.TunnelInterface[] = [...gre, ...ipip, ...eoip];

        return ifaces.map(line => {
            const _type = (() => {
                switch (line.type) {
                    case 'ether':
                        return 'ethernet';
                    case 'lo':
                        return 'loopback';
                    case 'gre-tunnel':
                        return 'gre';
                    case 'ipip-tunnel':
                        return 'ipip';
                    case 'eoip-tunnel':
                        return 'eoip';
                    case 'wg':
                        return 'wireguard';
                    default:
                        return line.type;
                }
            })();

            const tunnel = tunnels.filter(tunnel => tunnel.name === line.name).shift();

            const local_address = tunnel?.['local-address'];
            const remote_address = tunnel?.['remote-address'];

            const result: Interface = {
                name: line.name,
                type: _type
            };

            if (local_address) result.local_address = local_address;
            if (remote_address) result.remote_address = remote_address;
            if (line.comment) result.comment = line.comment;

            return result;
        });
    }

    /**
     * For all device IP addresses, counts the routes that exit (either directly or tunneled)
     * the device using each IP address
     *
     * @param min_distance
     * @param vrf
     */
    public async get_route_counts (
        min_distance = 0,
        vrf?: string
    ): Promise<Record<string, RouteCount>> {
        const [routes, ips] = await Promise.all([
            this.get_ip_routes(min_distance, vrf),
            this.get_ip_addresses()
        ]);

        const results: Record<string, RouteCount> = {};

        ips.forEach(ip => {
            results[ip.ipaddress] = {
                interface: ip.iface,
                count: routes.filter(route =>
                    route.preferred_source === ip.ipaddress || route.tunnel?.local_address === ip.ipaddress).length,
                active: false
            };
        });

        const best = {
            ip: '',
            count: 0
        };

        Object.keys(results).forEach(key => {
            if (results[key].count > best.count) {
                best.count = results[key].count;
                best.ip = key;
            }
        });

        if (results[best.ip]) {
            results[best.ip].active = true;
        }

        return results;
    }

    /**
     * Executes a bandwidth test
     *
     * Note: you must supply a callback in the options to get the intermittent results
     * of the bandwidth test; otherwise, you will only receive the final result back
     * from the promise
     *
     * @param target
     * @param username
     * @param password
     * @param options
     */
    public async bandwidth_test (
        target: string,
        username: string,
        password: string,
        options: Partial<Options> = {}
    ): Promise<Update> {
        // eslint-disable-next-line @typescript-eslint/no-this-alias
        const $ = this;

        const sleep = async (timeout: number) =>
            new Promise(resolve => setTimeout(resolve, timeout));

        const controller = new AbortController();
        options.signal ??= controller.signal;

        // eslint-disable-next-line no-async-promise-executor
        return new Promise(async (resolve, reject) => {
            options.duration ??= 15;
            options.direction ??= 'both';
            options.protocol ??= 'udp';
            options.random_data ??= false;
            options.callback ??= () => {};

            /**
             * This serves as a lazy "mutex" that prevents us from running
             * a bandwidth test for against a target host that is already
             * in the process of running a bandwidth test
             */
            while (await Mikrotik.cache.includes(target)) {
                if (options.callback) {
                    options.callback({
                        status: 'queued',
                        duration: 0,
                        randomData: options.random_data,
                        direction: options.direction,
                        connectionCount: 0,
                        localCPULoad: 0,
                        remoteCPULoad: 0
                    });
                }

                await sleep(1000);
            }

            const toBPS = (value?: string): number => {
                if (!value) {
                    return 0;
                }

                value = value.toLowerCase();

                if (value.includes('tbps')) {
                    const tmp = parseFloat(value) || 0;

                    return Math.round(tmp * 1000 * 1000 * 1000 * 1000);
                } else if (value.includes('gbps')) {
                    const tmp = parseFloat(value) || 0;

                    return Math.round(tmp * 1000 * 1000 * 1000);
                } else if (value.includes('mbps')) {
                    const tmp = parseFloat(value) || 0;

                    return Math.round(tmp * 1000 * 1000);
                } else if (value.includes('kbps')) {
                    const tmp = parseFloat(value) || 0;

                    return Math.round(tmp * 1000);
                } else {
                    return Math.round(parseFloat(value) || 0);
                }
            };

            /**
             * Performs further processing of the stream of data returned
             * during the bandwidth testing
             *
             * @param buffer
             */
            async function handleStream (buffer: Buffer) {
                const frame = new BandwidthTest.Frame(buffer).parse();

                const result: Update = {
                    status: frame.status as any,
                    duration: parseInt(frame.duration) || 0,
                    randomData: frame['random-data'] === 'yes',
                    direction: frame.direction as any,
                    connectionCount: parseInt(frame['connection-count']) || 0,
                    localCPULoad: (parseInt(frame['local-cpu-load']) || 0) / 100,
                    remoteCPULoad: (parseInt(frame['remote-cpu-load']) || 0) / 100
                };

                if (frame['lost-packets']) result.lostPackets = parseInt(frame['lost-packets']) || 0;

                if (frame['tx-current']) {
                    result.transmit = {
                        current: toBPS(frame['tx-current']),
                        shortAverage: toBPS(frame['tx-10-second-average']),
                        totalAverage: toBPS(frame['tx-total-average']),
                        size: toBPS(frame['tx-size'])
                    };
                }

                if (frame['rx-current']) {
                    result.receive = {
                        current: toBPS(frame['rx-current']),
                        shortAverage: toBPS(frame['rx-10-second-average']),
                        totalAverage: toBPS(frame['rx-total-average']),
                        size: toBPS(frame['rx-size'])
                    };
                }

                switch (result.status) {
                    case 'done testing':
                        if (options.callback) options.callback(result);
                        $.off('stream', handleStream);
                        return resolve(result);
                    case 'authentication_failed':
                        $.off('stream', handleStream);
                        return reject(new Error('Authentication Failed'));
                    case 'connecting':
                    case 'running':
                        await Mikrotik.cache.ttl(target, options.duration); // bump our mutex
                        if (options.callback) options.callback(result);
                        break;
                }
            }

            this.on('stream', handleStream);

            const cleanup = async () => {
                this.off('stream', handleStream);

                await Mikrotik.cache.del(target);
            };

            await Mikrotik.cache.set(target, target, options.duration); // set our mutex

            let command = `/tool bandwidth-test protocol=${options.protocol} ` +
                `user=${username} password=${password} ` +
                `duration=${options.duration}s direction=${options.direction} ` +
                `address=${target} random-data=${options.random_data ? 'yes' : 'no'} interval=1s`;

            if (options.local_tx_speed) {
                command += ` local-tx-speed=${options.local_tx_speed}M`;
            }

            if (options.remote_tx_speed) {
                command += ` remote-tx-speed=${options.remote_tx_speed}M`;
            }

            await this.stream(command,
                {
                    separator: '\r\n\r\n',
                    signal: options.signal
                });

            this.once('stream_complete', async () => {
                await cleanup();
            });

            this.once('stream_cancelled', async () => {
                await cleanup();

                return reject(new Error('Bandwidth Test Cancelled'));
            });

            if (options.timeout) {
                setTimeout(() => {
                    options.signal?.dispatchEvent(new Event('abort'));
                }, options.timeout);
            }
        });
    }

    /**
     * Pings the target IP address from the source IP address (if supplied)
     *
     * @param target
     * @param source
     */
    public async ping (target: string, source?: string): Promise<Ping> {
        const result: Ping = {
            target,
            latency: 2000
        };

        if (source) result.source = source;

        const command = `/ping address=${target} count=1${source ? ` src-address=${source}` : ''}`;

        try {
            const response = (await this.exec(command))
                .toString()
                .trim()
                .split('\n')
                .map(line => line.trim());

            for (const line of response) {
                const parts = line.split(/\s+/)
                    .map(part => part.trim());

                if (isNaN(parseInt(parts[0]))) continue;

                result.latency = parseInt(parts[4]) || 2000;
            }

            return result;
        } catch {
            return result;
        }
    }

    /**
     * Performs a traceroute to the target IP address from the source IP address (if supplied)
     *
     * @param target
     * @param source
     */
    public async traceroute (
        target: string,
        source?: string
    ): Promise<Traceroute[]> {
        const command = `/tool traceroute address=${target} count=1${source ? ` src-address=${source}` : ''}`;

        const response = (await this.exec(command))
            .toString()
            .split('\r\n\r\n')
            .map(frame => frame.trim())
            .filter(frame => frame.length !== 0)
            .map(frame => frame.split('\r\n')
                .map(line => line.trim())
                .map(line => line.split(/\s+/)
                    .map(col => col.trim()))
                .filter(col => !isNaN(parseInt(col[0]))))
            .pop();

        if (!response) throw new Error(`Could not perform traceroute to ${target}`);

        const results: Traceroute[] = [];

        const resolveDNS = async (ip: string): Promise<[string, string | undefined]> => new Promise(resolve => {
            reverse(ip, (error, addresses) => {
                if (error) return resolve([ip, undefined]);

                return resolve([ip, addresses.shift()]);
            });
        });

        for (const [hop, address, loss, sent, last, avg, best, worst] of response) {
            const result: Traceroute = {
                hop: parseInt(hop),
                loss: (sent === 'timeout' ? parseInt(address) : parseInt(loss)) / 100,
                sent: sent === 'timeout' ? parseInt(loss) : parseInt(sent),
                last: sent === 'timeout' ? 2000 : parseInt(last),
                average: sent === 'timeout' ? 2000 : parseInt(avg),
                best: sent === 'timeout' ? 2000 : parseInt(best),
                worst: sent === 'timeout' ? 2000 : parseInt(worst),
                timeout: sent === 'timeout'
            };

            if (sent !== 'timeout') result.address = address;

            results.push(result);
        }

        (await Promise.all(
            results.filter(result => result.address)
                .map(result => resolveDNS(result.address || ''))))
            .forEach(result => {
                for (let i = 0; i < results.length; i++) {
                    if (result[0] === results[i].address && result[1]) {
                        results[i].hostname = result[1];
                    }
                }
            });

        return results;
    }

    /**
     * Fetches routerboard information from the device
     */
    public async routerboard (): Promise<Response.Routerboard> {
        const result = await this.kvs<CommandResponses.Routeboard>(
            '/system routerboard print');

        return {
            routerboard: result.routerboard === 'yes',
            board_name: result['board-name'],
            model: result.model,
            serial_number: result['serial-number'],
            firmware_type: result['firmware-type'],
            factory_firmware: toVersion(result['factory-firmware']),
            current_firmware: toVersion(result['current-firmware']),
            upgrade_firmware: toVersion(result['upgrade-firmware'])
        };
    }

    /**
     * Fetches the identity of the device
     */
    public async identity (): Promise<string> {
        const response = await this.kvs<CommandResponses.Identity>(
            '/system identity print');

        return response.name;
    }

    /**
     * Fetches the resource information of the device
     */
    public async resource (): Promise<Response.Resource> {
        const response = await this.kvs<CommandResponses.Resource>(
            '/system resource print');

        const result: Response.Resource = {
            uptime: response.uptime,
            version: toVersion(response.version),
            build_time: new Date(`${response['build-time']}Z`),
            factory_sofware: response['factory-software'],
            free_memory: response['free-memory'],
            total_memory: response['total-memory'],
            cpu: response.cpu,
            cpu_count: parseInt(response['cpu-count']) || 0,
            cpu_frequency: parseInt(response['cpu-frequency']) || 0,
            cpu_load: (parseInt(response['cpu-load']) || 0) / 100,
            hdd_space: {
                free: response['free-hdd-space'],
                total: response['total-hdd-space']
            },
            architecture_name: response['architecture-name'],
            board_name: response['board-name'],
            platform: response.platform
        };

        if (response.version.includes('long-term')) {
            result.lts = true;
        } else if (response.version.includes('stable')) {
            result.stable = true;
        } else if (response.version.includes('testing')) {
            result.testing = true;
        } else if (response.version.includes('development')) {
            result.development = true;
        }

        if (response['write-sect-since-reboot'] && response['write-sect-total'] && response['bad-blocks']) {
            result.nvram = {
                write_since_reboot: parseInt(response['write-sect-since-reboot']) || 0,
                write_total: parseInt(response['write-sect-total']) || 0,
                bad_blocks: parseInt(response['bad-blocks']) || 0
            };
        }

        return result;
    }

    /**
     * Fetches the current RouterOS version
     */
    public async version (): Promise<string> {
        return (await this.resource()).version;
    }

    /**
     * Fetches the semantic RouterOS version
     */
    public async semantic_version (): Promise<{ major: number; minor: number; patch: number }> {
        const version = await this.version();

        const [major, minor, patch] = version.split('.')
            .map(elem => parseInt(elem) || 0);

        return {
            major,
            minor,
            patch
        };
    }

    /**
     * Fetches the current health information
     */
    public async health (): Promise<Response.Health> {
        const { major } = await this.semantic_version();

        const result: Response.Health = {} as any;

        if (major === 6) {
            const response = await this.kvs<CommandResponses.Health>(
                '/system health print');

            result.voltage = parseFloat(response.voltage) || 0;
            result.current = parseFloat(response.current) || 0;
            result.temperature = parseFloat(response.temperature) || 0;
            result.power_consumption = parseFloat(response['power-consumption']) || 0;

            if (response['psu-voltage']) {
                result.psu_voltage = parseFloat(response['psu-voltage']);
            }

            if (response['psu1-voltage']) {
                result.psu1_voltage = parseFloat(response['psu1-voltage']);
            }

            if (response['psu2-voltage']) {
                result.psu2_voltage = parseFloat(response['psu2-voltage']);
            }

            return result;
        } else if (major === 7) {
            const response = await this.terse<{ name: string, value: string, type: string }>(
                '/system health print terse');

            for (const { name, value, type } of response) {
                const num = parseFloat(value) || 0;

                switch (name) {
                    case 'voltage':
                        result.voltage = num;
                        break;
                    case 'temperature':
                        result.temperature = num;
                        break;
                    case 'power-consumption':
                        result.power_consumption = num;
                        break;
                    case 'current':
                        result.current = type === 'A' ? num * 1000 : num;
                        break;
                    case 'psu-voltage':
                        result.psu_voltage = num;
                        break;
                    case 'psu1-voltage':
                        result.psu1_voltage = num;
                        break;
                    case 'psu2-voltage':
                        result.psu2_voltage = num;
                }
            }

            return result;
        } else {
            throw new Error('RouterOS version is not supported for this command');
        }
    }

    /**
     * Executes a command with expected terse response and parses it accordingly
     *
     * @param command
     * @protected
     */
    public async terse<Type extends object = any> (
        command: string
    ): Promise<Type[]> {
        const results: Type[] = [];

        const lines = (await this.exec(command))
            .toString()
            .split('\r\n')
            .map(line => line.trim())
            .filter(line => line.split(/\s+/).length !== 0 && line.length !== 0);

        lines.forEach(line => {
            const result: Type = {} as any;

            line.split(/\s+/)
                .map(col => col.trim())
                .forEach(col => {
                    if (col.includes('=')) {
                        const [key, ...value] = col.split('=');

                        (result as any)[key] = value.join('=');
                    } else {
                        (result as any)[col] = col;
                    }
                });

            if (Object.keys(result).length !== 0) results.push(result);
        });

        return results;
    }

    /**
     * Executes a command that expects the result as a 'table' of key-value pairs separated by a colon (:)
     *
     * @param command
     * @protected
     */
    public async kvs<Type extends object = any> (
        command: string
    ): Promise<Type> {
        const result: Type = {} as any;

        const lines = (await this.exec(command))
            .toString()
            .split('\r\n')
            .map(line => line.trim())
            .filter(line => line.length !== 0)
            .map(line => line.split(':')
                .map(col => col.trim()));

        for (const [key, ...value] of lines) {
            (result as any)[key] = value.join(':');
        }

        return result;
    }
}
