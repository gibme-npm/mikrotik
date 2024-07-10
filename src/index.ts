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

import SSH from '@gibme/ssh';
import { BandwidthTest, Response } from './types';
import ip from 'ip';
import Cache from '@gibme/cache/memory';
import { reverse } from 'dns';
export { ConnectConfig } from '@gibme/ssh';

export type Direction = BandwidthTest.Direction;
export type Protocol = BandwidthTest.Protocol;
export type Status = BandwidthTest.Status;
export type Update = BandwidthTest.Update;
export type Options = BandwidthTest.Options;

export type Address = Response.Address;
export type Interface = Response.Interface;
export type Route = Response.Route;
export type RouteCount = Response.RouteCount;
export type Ping = Response.Ping;
export type Traceroute = Response.Traceroute;

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
     */
    public async get_ip_routes (
        min_distance = 0,
        vrf?: string
    ): Promise<Route[]> {
        const ifaces = await this.get_interfaces();

        const ips = await this.get_ip_addresses();

        const routes = await this.terse<{
            'dst-address': string;
            gateway: string;
            distance: string;
            scope: string;
            target_scope: string;
            'routing-mark'?: string;
        }>('/ip route print terse without-paging where active');

        return routes.map(route => {
            const _network = route['dst-address'].split('/');
            const address = _network[0];
            const cidr = parseInt(_network[1]);
            const [gateway, iface] = (() => {
                if (route.gateway) {
                    if (route.gateway.includes('%')) {
                        return route.gateway.split('%', 2);
                    } else if (ip.isV4Format(route.gateway)) {
                        const ip = ips.filter(ip => ip.isLocal(route.gateway)).shift();

                        return [route.gateway, ip?.iface];
                    } else {
                        const ip = ips.filter(ip => ip.iface === route.gateway).shift();

                        return [ip?.ipaddress, route.gateway];
                    }
                } else {
                    return [undefined, undefined];
                }
            })();
            const distance = parseInt(route.distance);
            const scope = parseInt(route.scope);
            const target_scope = parseInt(route.target_scope) || undefined;

            // this does not account for if a device has multiple addresses in the same network
            const preferred_source = ips.filter(ip => gateway ? ip.isLocal(gateway) : false).shift()?.ipaddress;
            const _vrf = route['routing-mark'] || 'main';

            const tunnel = (() => {
                const tunnel = ifaces.filter(_iface => _iface.name === iface).shift();

                if (!tunnel) return undefined;

                const root = ips.filter(ip => ip.ipaddress === tunnel.local_address).shift();

                if (!root) return undefined;

                return {
                    ...tunnel,
                    root
                };
            })();

            return {
                network: {
                    address,
                    cidr
                },
                preferred_source,
                gateway,
                iface,
                tunnel,
                distance,
                scope,
                target_scope,
                vrf: _vrf
            };
        })
            .filter(route => route.distance >= min_distance)
            .filter(route => vrf ? route.vrf === vrf : true);
    }

    /**
     * Retrieves the IP addresses active on the system
     */
    public async get_ip_addresses (): Promise<Address[]> {
        const addresses = await this.terse<{
            address: string,
            network: string;
            interface: string
        }>('/ip address print terse without-paging where !disabled');

        return addresses.map(line => {
            const _address = line.address.split('/');
            const ipaddress = _address[0];
            const cidr = parseInt(_address[1]);

            return {
                ipaddress,
                network: line.network,
                cidr,
                iface: line.interface,
                isLocal: (ipaddress: string): boolean =>
                    ip.cidrSubnet(`${line.network}/${cidr}`).contains(ipaddress)
            };
        });
    }

    /**
     * Retrieves the interfaces active on the system
     */
    public async get_interfaces (): Promise<Interface[]> {
        const ifaces = await this.terse<{
            name: string;
            type: string;
        }>('/interface print terse without-paging where !disabled');

        const gre = await this.terse<{
            name: string;
            'local-address': string;
            'remote-address': string;
        }>('/interface gre print terse without-paging where !disabled');

        const ipip = await this.terse<{
            name: string;
            'local-address': string;
            'remote-address': string;
        }>('/interface ipip print terse without-paging where !disabled');

        const eoip = await this.terse<{
            name: string;
            'local-address': string;
            'remote-address': string;
        }>('/interface eoip print terse without-paging where !disabled');

        return ifaces.map(line => {
            const _type = (() => {
                switch (line.type) {
                    case 'gre-tunnel':
                        return 'gre';
                    case 'ipip-tunnel':
                        return 'ipip';
                    case 'eoip-tunnel':
                        return 'eoip';
                    default:
                        return line.type;
                }
            })();

            const local_address = (() => {
                switch (line.type) {
                    case 'gre-tunnel':
                        return gre.filter(tunnel => tunnel.name === line.name)[0]['local-address'];
                    case 'ipip':
                        return ipip.filter(tunnel => tunnel.name === line.name)[0]['local-address'];
                    case 'eoip':
                        return eoip.filter(tunnel => tunnel.name === line.name)[0]['local-address'];
                    default:
                        return undefined;
                }
            })();

            const remote_address = (() => {
                switch (line.type) {
                    case 'gre-tunnel':
                        return gre.filter(tunnel => tunnel.name === line.name)[0]['remote-address'];
                    case 'ipip':
                        return ipip.filter(tunnel => tunnel.name === line.name)[0]['remote-address'];
                    case 'eoip':
                        return eoip.filter(tunnel => tunnel.name === line.name)[0]['remote-address'];
                    default:
                        return undefined;
                }
            })();

            return {
                name: line.name,
                type: _type,
                local_address,
                remote_address
            };
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
        const routes = await this.get_ip_routes(min_distance, vrf);

        const ips = await this.get_ip_addresses();

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

        for (const key of Object.keys(results)) {
            if (results[key].count > best.count) {
                best.count = results[key].count;
                best.ip = key;
            }
        }

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
        options: Partial<Options> = {
            duration: 15,
            direction: 'both',
            protocol: 'udp',
            random_data: false,
            callback: () => {}
        }
    ): Promise<Update> {
        // eslint-disable-next-line @typescript-eslint/no-this-alias
        const $ = this;

        const sleep = async (timeout: number) =>
            new Promise(resolve => setTimeout(resolve, timeout));

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

            await Mikrotik.cache.set(target, target, options.duration); // set our mutex

            await this.stream(`/tool bandwidth-test protocol=${options.protocol} ` +
                `user=${username} password=${password} ` +
                `duration=${options.duration}s direction=${options.direction} ` +
                `address=${target} random-data=${options.random_data ? 'yes' : 'no'} interval=1s`,
            {
                separator: '\r\n\r\n'
            });

            await Mikrotik.cache.del(target); // release our mutex
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

        let command = `/ping address=${target} count=1`;

        if (source) {
            command += ` src-address=${source}`;
        }

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
        let command = `/tool traceroute address=${target} count=1`;

        if (source) {
            command += ` src-address=${source}`;
        }

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

        const resolve = async (ip: string): Promise<[string, string | undefined]> => new Promise(resolve => {
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
                .map(result => resolve(result.address || ''))))
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
     * Executes a command with expected terse response and parses it accordingly
     *
     * @param command
     * @protected
     */
    protected async terse<Type extends object = any> (command: string): Promise<Type[]> {
        const results: Type[] = [];

        const lines = (await this.exec(command))
            .toString()
            .split('\r\n')
            .map(line => line.trim())
            .filter(line =>
                line.split(/\s+/)
                    .length !== 0 && line.length !== 0);

        lines.forEach(line => {
            const result: Type = {} as any;

            line.split(/\s+/)
                .filter(col => col.includes('='))
                .forEach(col => {
                    const [key, value] = col.split('=', 2);

                    (result as any)[key] = value;
                });

            if (Object.keys(result).length !== 0) results.push(result);
        });

        return results;
    }
}
