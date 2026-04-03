// Copyright (c) 2024-2025, Brandon Lehmann <brandonlehmann@gmail.com>
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

import Mikrotik from '../src';
import { it, describe, after } from 'node:test';
import assert from 'assert';
import { config } from 'dotenv';

config({ quiet: true });

describe('Unit Tests', async () => {
    const enabled = !!(process.env.SSH_HOST && process.env.SSH_USER && process.env.SSH_PASSWORD);
    const device = new Mikrotik({
        host: process.env.SSH_HOST,
        username: process.env.SSH_USER,
        password: process.env.SSH_PASSWORD
    });
    const connected = () => device.connected;
    const bwtest_enabled = !!(process.env.BWTEST_HOST && process.env.BWTEST_USER && process.env.BWTEST_PASSWORD);

    after(async () => {
        await device.destroy();
    });

    it('Connect()', { skip: false }, async (t) => {
        if (!enabled) return t.skip('SSH credentials not configured');

        try {
            await device.connect();
        } catch {}
    });

    it('get_interfaces()', { skip: false }, async (t) => {
        if (!connected()) return t.skip('Not connected');

        const interfaces = await device.get_interfaces();

        assert.notEqual(interfaces.length, 0);
    });

    it('get_ip_addresses()', { skip: false }, async (t) => {
        if (!connected()) return t.skip('Not connected');

        const addresses = await device.get_ip_addresses();

        assert.notEqual(addresses.length, 0);
    });

    it('get_ip_routes()', { skip: false }, async (t) => {
        if (!connected()) return t.skip('Not connected');

        const routes = await device.get_ip_routes();

        assert.notEqual(routes.length, 0);
    });

    it('get_route_counts()', { skip: false }, async (t) => {
        if (!connected()) return t.skip('Not connected');

        const route_counts = await device.get_route_counts();

        assert.notEqual(Object.keys(route_counts).length, 0);
    });

    it('ping()', { skip: false }, async (t) => {
        if (!connected()) return t.skip('Not connected');

        const result = await device.ping('1.1.1.1');

        assert.notEqual(result.latency, 0);
    });

    it('traceroute()', { skip: false }, async (t) => {
        if (!connected()) return t.skip('Not connected');

        const hops = await device.traceroute('1.1.1.1');

        assert.notEqual(hops.length, 0);
    });

    it('routerboard()', { skip: false }, async (t) => {
        if (!connected()) return t.skip('Not connected');

        const result = await device.routerboard();

        assert.notEqual(Object.keys(result).length, 0);
    });

    it('identity()', { skip: false }, async (t) => {
        if (!connected()) return t.skip('Not connected');

        const result = await device.identity();

        assert.notEqual(result.length, 0);
    });

    it('resource()', { skip: false }, async (t) => {
        if (!connected()) return t.skip('Not connected');

        const result = await device.resource();

        assert.notEqual(Object.keys(result).length, 0);
    });

    it('version()', { skip: false }, async (t) => {
        if (!connected()) return t.skip('Not connected');

        const result = await device.version();

        assert.notEqual(result.length, 0);
    });

    it('semantic_version()', { skip: false }, async (t) => {
        if (!connected()) return t.skip('Not connected');

        const result = await device.semantic_version();

        assert.notEqual(Object.keys(result).length, 0);
    });

    it('health()', { skip: false }, async (t) => {
        if (!connected()) return t.skip('Not connected');

        const result = await device.health();

        assert.notEqual(Object.keys(result).length, 0);
    });

    it('bandwidth_test()', { skip: false }, async (t) => {
        if (!connected()) return t.skip('Not connected');
        if (!bwtest_enabled) return t.skip('Bandwidth test credentials not configured');

        const target = process.env.BWTEST_HOST;
        const user = process.env.BWTEST_USER;
        const password = process.env.BWTEST_PASSWORD;

        if (!target || !user || !password) {
            return t.skip('Bandwidth test credentials not configured');
        }

        const test = await device.bandwidth_test(target, user, password, {
            duration: 5,
            direction: 'transmit',
            protocol: 'udp',
            callback: (update: Mikrotik.BandwidthTest.Update) => {
                console.warn(JSON.stringify(update));
            }
        });

        assert.notEqual(test.duration, 0);
    });
});
