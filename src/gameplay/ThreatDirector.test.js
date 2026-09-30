import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ThreatDirector, THREATS_BY_NIGHT } from './ThreatDirector.js';
import { Threat } from './threats/Threat.js';

/** A threat that records what the director asked of it. */
class FakeThreat extends Threat {
  constructor(objective = '') {
    super();
    this.objective = objective;
    this.starts = 0;
    this.stops = 0;
    this.updates = 0;
    this.elapsed = 0;
  }
  onStart() { this.starts++; this.elapsed = 0; }
  onStop()  { this.stops++; }
  update(dt) { this.updates++; this.elapsed += dt; }
}

describe('Threat', () => {
  it('start(ctx) keeps the context and goes active; stop() goes inactive once', () => {
    const t = new FakeThreat();
    const ctx = { controller: { fail: vi.fn() } };
    t.start(ctx);
    expect(t.active).toBe(true);
    expect(t.ctx).toBe(ctx);

    t.stop();
    t.stop();
    expect(t.active).toBe(false);
    expect(t.stops).toBe(1);
  });

  it('kill(reason) ends the night through the controller', () => {
    const t = new FakeThreat();
    const controller = { fail: vi.fn() };
    t.start({ controller });
    t.kill('It was waiting.');
    expect(controller.fail).toHaveBeenCalledWith('It was waiting.');
  });
});

describe('ThreatDirector', () => {
  let controller, engine, hud, director, demon, watchers, camera;

  beforeEach(() => {
    controller = { state: 'idle', nightNumber: 0, fail: vi.fn() };
    engine = { debugCamera: { active: false } };
    hud = { setObjective: vi.fn() };
    director = new ThreatDirector({ controller, hud, context: { engine } });
    demon    = director.register('sleepDemon',     new FakeThreat('Eat, or it gets closer.'));
    watchers = director.register('windowWatchers', new FakeThreat("Don't let it see you."));
    camera   = director.register('cameraEntity',   new FakeThreat('Stay out of its view.'));
  });

  const play = (night) => { controller.state = 'playing'; controller.nightNumber = night; };

  it('gives each night its own threat (decision D1)', () => {
    expect(THREATS_BY_NIGHT).toEqual({ 1: ['sleepDemon'], 2: ['windowWatchers'], 3: ['cameraEntity'] });
  });

  it("starts night N's threats when the state becomes playing, with the scene context", () => {
    director.onUpdate(0.016);
    expect(demon.active).toBe(false);

    play(2);
    director.onUpdate(0.016);
    expect(watchers.active).toBe(true);
    expect(watchers.ctx.controller).toBe(controller);
    expect(watchers.ctx.engine).toBe(engine);
    expect(demon.active).toBe(false);
    expect(camera.active).toBe(false);
    expect(hud.setObjective).toHaveBeenLastCalledWith("Don't let it see you.");
  });

  it('updates the active threats every frame while playing', () => {
    play(1);
    director.onUpdate(0.5);
    director.onUpdate(0.25);
    expect(demon.updates).toBe(2);
    expect(demon.elapsed).toBeCloseTo(0.75);
    expect(watchers.updates).toBe(0);
  });

  it('stops them in the morning and on a failed night, and clears the objective', () => {
    play(1);
    director.onUpdate(0.016);

    controller.state = 'morning';
    director.onUpdate(0.016);
    expect(demon.active).toBe(false);
    expect(hud.setObjective).toHaveBeenLastCalledWith('');

    play(2);
    director.onUpdate(0.016);
    controller.state = 'gameOver';
    director.onUpdate(0.016);
    expect(watchers.active).toBe(false);
  });

  it('nothing updates while the night is not being played', () => {
    play(3);
    director.onUpdate(0.016);
    controller.state = 'gameOver';
    for (let i = 0; i < 5; i++) director.onUpdate(1);
    expect(camera.updates).toBe(1);
  });

  it('a retry (same night, gameOver → playing) restarts the threats fresh', () => {
    play(2);
    director.onUpdate(0.016);
    director.onUpdate(10);
    controller.state = 'gameOver';
    director.onUpdate(0.016);

    controller.state = 'playing';
    director.onUpdate(0.016);
    expect(watchers.starts).toBe(2);
    expect(watchers.active).toBe(true);
    expect(watchers.elapsed).toBeCloseTo(0.016);
  });

  it('a night change while playing (the N key) swaps the threats', () => {
    play(1);
    director.onUpdate(0.016);
    controller.nightNumber = 2;
    director.onUpdate(0.016);
    expect(demon.active).toBe(false);
    expect(demon.stops).toBe(1);
    expect(watchers.active).toBe(true);
  });

  it('holds every threat while the fly camera is active — the player is frozen', () => {
    play(1);
    director.onUpdate(0.016);
    engine.debugCamera.active = true;
    director.onUpdate(5);
    expect(demon.updates).toBe(1);
    expect(demon.active).toBe(true);
    engine.debugCamera.active = false;
    director.onUpdate(0.016);
    expect(demon.updates).toBe(2);
  });

  it('skips a night key with no registered threat instead of throwing', () => {
    const lone = new ThreatDirector({ controller, context: {} });
    play(3);
    expect(() => lone.onUpdate(0.016)).not.toThrow();
  });

  it('a cumulative table is one line (decision D1)', () => {
    const cumulative = new ThreatDirector({
      controller, context: {}, threatsByNight: { 2: ['sleepDemon', 'windowWatchers'] },
    });
    const a = cumulative.register('sleepDemon', new FakeThreat());
    const b = cumulative.register('windowWatchers', new FakeThreat());
    play(2);
    cumulative.onUpdate(0.016);
    expect(a.active && b.active).toBe(true);
  });

  it('dispose() stops them all', () => {
    play(2);
    director.onUpdate(0.016);
    director.dispose();
    expect(watchers.active).toBe(false);
    expect(director.active).toHaveLength(0);
  });

  it('allocates nothing per frame: the active list is one array, reused', () => {
    play(1);
    director.onUpdate(0.016);
    const list = director.active;
    controller.nightNumber = 2;
    director.onUpdate(0.016);
    controller.state = 'morning';
    director.onUpdate(0.016);
    expect(director.active).toBe(list);
  });

  it("onNap asks tonight's threats, and only tonight's, whether the nap ends the night", () => {
    play(1);
    director.onUpdate(0.016);
    expect(director.onNap(() => 0)).toBe(false);          // the base Threat never does
    demon.onNap = vi.fn(() => true);
    watchers.onNap = vi.fn(() => true);
    expect(director.onNap(() => 0)).toBe(true);
    expect(demon.onNap).toHaveBeenCalledOnce();
    expect(watchers.onNap).not.toHaveBeenCalled();         // not tonight's
  });

  it('onNap passes its rand to the threat', () => {
    play(1);
    director.onUpdate(0.016);
    const rand = () => 0.5;
    demon.onNap = vi.fn(() => false);
    director.onNap(rand);
    expect(demon.onNap).toHaveBeenCalledWith(rand);
  });
});
