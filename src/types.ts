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
    }
}

export namespace Response {
    export interface Address {
        ipaddress: string;
        network: string;
        cidr: number;
        iface: string;

        isLocal(ipaddress: string): boolean;
    }

    export interface Interface {
        name: string;
        type: string;
        local_address?: string;
        remote_address?: string;
    }

    export interface Tunnel extends Interface {
        root: Address;
    }

    export interface Route {
        network: {
            address: string;
            cidr: number;
        };
        preferred_source?: string;
        gateway?: string;
        iface?: string;
        tunnel?: Tunnel;
        distance: number;
        scope: number;
        target_scope?: number;
        vrf: string;
    }

    export interface RouteCount {
        interface: string;
        count: number;
        active: boolean;
    }

    export interface Ping {
        source?: string;
        target: string;
        latency: number;
    }

    export interface Traceroute {
        hop: number;
        address?: string;
        hostname?: string;
        loss: number;
        sent: number;
        last: number;
        average: number;
        best: number;
        worst: number;
        timeout: boolean;
    }
}
