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

import type { AbortSignal } from 'abort-controller';

export namespace BandwidthTest {
    export type Direction = 'both' | 'transmit' | 'receive';

    export type Protocol = 'udp' | 'tcp';

    export type Status = 'running' | 'connecting' | 'done testing' | 'authentication_failed' | 'queued';

    /**
     * Class that helps with processing a "frame" of the Bandwidth Test response
     */
    export class Frame {
        private parsed?: Record<string, string>;

        // eslint-disable-next-line no-useless-constructor
        constructor (public readonly buffer: Buffer) {
        }

        public parse (): Record<string, string> {
            if (!this.parsed) {
                this.parsed = {};

                const records = this.buffer.toString('utf8').trim()
                    .split('\n')
                    .map(line => line.trim())
                    .map(line => line.split(':', 2)
                        .map(elem => elem.trim()));

                for (const [key, value] of records) {
                    if (key.length === 0) continue;

                    this.parsed[key.toLowerCase()] = value;
                }
            }

            return this.parsed;
        }
    }

    interface DirectionStats {
        current: number;
        shortAverage: number;
        totalAverage: number;
        size: number;
    }

    export interface Update {
        status: Status;
        duration: number;
        transmit?: DirectionStats;
        receive?: DirectionStats;
        lostPackets?: number;
        randomData: boolean;
        direction: Direction;
        connectionCount: number;
        localCPULoad: number;
        remoteCPULoad: number;
    }

    export interface Options {
        duration: number;
        direction: Direction;
        protocol: Protocol;
        random_data: boolean;
        callback: (frame: Update) => void;
        timeout: number;
        signal: AbortSignal;
        /**
         * In Megabits
         */
        local_tx_speed: number;
        /**
         * In Megabits
         */
        remote_tx_speed: number;
    }
}

export namespace CommandResponses {
    export type YesNo = 'yes' | 'no';

    export interface Comment {
        comment?: string;
    }

    export interface Route extends Comment {
        'dst-address': string;
        gateway: string;
        distance: string;
        scope: string;
        target_scope: string;
        'routing-table'?: string;
        'routing-mark'?: string;
        'bgp-as-path'?: string;
        'bgp-origin'?: string;
        'bgp-local-pref'?: string;
        'received-from'?: string;
        'check-gateway'?: string;
        'suppress-hw-offload'?: string;
        'blackhole'?: string;
        'immediate-gw'?: string;
        reachable?: string;
        'gateway-status'?: string;
    }

    export interface Address extends Comment {
        address: string;
        network: string;
        interface: string;
        'actual-interface': string;
    }

    export interface Interface extends Comment {
        name: string;
        type: string;
        mtu: string;
        'default-name'?: string;
        'actual-mtu': string;
        'mac-address'?: string;
        'link-downs'?: string;
        l2mtu?: string;
    }

    export interface TunnelInterface extends Omit<Interface, 'type'>, Comment {
        'local-address': string;
        'remote-address': string;
        'clamp-tcp-mss': YesNo;
        'dont-fragment': YesNo;
        'allow-fast-path': YesNo;
    }

    export interface Routeboard {
        routerboard: YesNo;
        'board-name': string;
        model: string;
        'serial-number': string;
        'firmware-type': string;
        'factory-firmware': string;
        'current-firmware': string;
        'upgrade-firmware': string;
    }

    export interface Identity {
        name: string;
    }

    export interface Resource {
        uptime: string;
        version: string;
        'build-time': string;
        'factory-software': string;
        'free-memory': string;
        'total-memory': string;
        cpu: string;
        'cpu-count': string;
        'cpu-frequency': string;
        'cpu-load': string;
        'free-hdd-space': string;
        'total-hdd-space': string;
        'architecture-name': string;
        'board-name': string;
        platform: string;
        'write-sect-since-reboot'?: string;
        'write-sect-total'?: string;
        'bad-blocks'?: string;
    }

    export interface Health {
        voltage: string;
        current: string;
        temperature: string;
        'power-consumption': string;
        'psu-voltage'?: string;
        'psu1-voltage'?: string;
        'psu2-voltage'?: string;
    }
}

export namespace Response {
    interface includesAddress {
        includes(ipaddress: string): boolean;
    }

    interface Comment {
        comment?: string;
    }

    export interface Address extends includesAddress, Comment {
        ipaddress: string;
        network: string;
        cidr: number;
        iface: string;
    }

    export interface Interface extends Comment {
        name: string;
        type: string;
        local_address?: string;
        remote_address?: string;
    }

    export interface Tunnel extends Interface {
        parent: Address;
    }

    export interface Route extends includesAddress, Comment {
        network: string;
        cidr: number;
        distance: number;
        scope: number;
        vrf: string;
        preferred_source?: string;
        gateway?: string;
        iface?: string;
        tunnel?: Tunnel;
        target_scope?: number;
    }

    export interface RouteCount {
        interface: string;
        count: number;
        active: boolean;
    }

    export interface Ping {
        target: string;
        latency: number;
        source?: string;
    }

    export interface Traceroute {
        hop: number;
        loss: number;
        sent: number;
        last: number;
        average: number;
        best: number;
        worst: number;
        timeout: boolean;
        address?: string;
        hostname?: string;
    }

    export interface Routerboard {
        routerboard: boolean;
        board_name: string;
        model: string;
        serial_number: string;
        firmware_type: string;
        factory_firmware: string;
        current_firmware: string;
        upgrade_firmware: string;
    }

    export interface Resource {
        uptime: string;
        version: string;
        build_time: Date;
        factory_sofware: string;
        free_memory: string;
        total_memory: string;
        cpu: string;
        cpu_count: number;
        cpu_frequency: number;
        cpu_load: number;
        hdd_space: {
            free: string;
            total: string;
        };
        architecture_name: string;
        board_name: string;
        platform: string;
        lts?: boolean;
        stable?: boolean;
        testing?: boolean;
        development?: boolean;
        nvram?: {
            write_since_reboot: number;
            write_total: number;
            bad_blocks: number;
        }
    }

    export interface Health {
        voltage: number;
        current: number;
        temperature: number;
        power_consumption: number;
        psu_voltage?: number;
        psu1_voltage?: number;
        psu2_voltage?: number;
    }
}
