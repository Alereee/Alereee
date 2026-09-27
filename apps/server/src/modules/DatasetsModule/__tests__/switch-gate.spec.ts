import { describe, expect, it, jest } from '@jest/globals';
import { EventEmitter } from 'node:events';
import type { Request, Response } from 'express';
import { SwitchGate, switchGateMiddleware } from '../switch-gate';

// A switch of the active dataset closes the connection and opens it on
// another schema (issue #527): requests and the switch take turns

const tick = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

describe('SwitchGate', () => {
  it('lets requests through while nothing is switched', async () => {
    const gate = new SwitchGate();
    await gate.enter();
    await gate.enter();
    expect(gate.busy).toBe(2);
    gate.leave();
    gate.leave();
    gate.leave();
    expect(gate.busy).toBe(0);
  });

  it('waits for the requests under way before the switch begins', async () => {
    const gate = new SwitchGate();
    const order: string[] = [];
    await gate.enter();
    await gate.enter();

    const held = gate.hold(async () => {
      order.push('switch');
      return 'done';
    });
    await tick();
    expect(order).toEqual([]);
    gate.leave();
    await tick();
    expect(order).toEqual([]);
    gate.leave();

    await expect(held).resolves.toEqual({ result: 'done', abandoned: 0 });
    expect(order).toEqual(['switch']);
  });

  it('holds the requests that arrive during the switch until it is over', async () => {
    const gate = new SwitchGate();
    const order: string[] = [];
    let finish!: () => void;

    const held = gate.hold(
      () =>
        new Promise<void>((resolve) => {
          finish = () => {
            order.push('switched');
            resolve();
          };
        }),
    );
    await tick();
    const arrived = gate.enter().then(() => order.push('request'));
    await tick();
    expect(order).toEqual([]);
    expect(gate.busy).toBe(0);

    finish();
    await held;
    await arrived;
    expect(order).toEqual(['switched', 'request']);
    expect(gate.busy).toBe(1);
  });

  it('goes ahead without a request that does not finish, and says how many it left behind', async () => {
    const gate = new SwitchGate();
    await gate.enter();

    await expect(gate.hold(async () => 'done', 20)).resolves.toEqual({ result: 'done', abandoned: 1 });
  });

  it('opens again when the switch fails', async () => {
    const gate = new SwitchGate();

    await expect(
      gate.hold(async () => {
        throw new Error('no connection');
      }),
    ).rejects.toThrow('no connection');
    await gate.enter();
    expect(gate.busy).toBe(1);
  });
});

describe('switchGateMiddleware', () => {
  const call = (gate: SwitchGate, path: string) => {
    const res = new EventEmitter();
    const next = jest.fn();
    switchGateMiddleware(gate)(
      { originalUrl: path, url: path, path } as Request,
      res as unknown as Response,
      next,
    );
    return { res, next };
  };

  it('counts a request in and, when its response closes, out', async () => {
    const gate = new SwitchGate();
    const { res, next } = call(gate, '/api/v1/words/lamp');
    await tick();
    expect(next).toHaveBeenCalledTimes(1);
    expect(gate.busy).toBe(1);

    res.emit('close');
    expect(gate.busy).toBe(0);
  });

  it('does not count the request that asks for the switch, nor make it wait', async () => {
    const gate = new SwitchGate();
    let finish!: () => void;
    const held = gate.hold(() => new Promise<void>((resolve) => (finish = resolve)));
    await tick();

    const activate = call(gate, '/api/en/datasets/wiktionary/activate');
    const other = call(gate, '/api/en/datasets');
    await tick();
    expect(activate.next).toHaveBeenCalledTimes(1);
    expect(other.next).not.toHaveBeenCalled();
    expect(gate.busy).toBe(0);

    finish();
    await held;
    await tick();
    expect(other.next).toHaveBeenCalledTimes(1);
  });

  it('forgets a client that gave up while it waited', async () => {
    const gate = new SwitchGate();
    let finish!: () => void;
    const held = gate.hold(() => new Promise<void>((resolve) => (finish = resolve)));
    await tick();
    const { res, next } = call(gate, '/api/v1/words/lamp');
    res.emit('close');

    finish();
    await held;
    await tick();
    expect(next).not.toHaveBeenCalled();
    expect(gate.busy).toBe(0);
  });
});
