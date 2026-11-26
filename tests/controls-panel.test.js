import assert from 'node:assert/strict';
import test from 'node:test';
import { createControlsPanel } from '../src/controls-panel.js';

class Control extends EventTarget {
  attributes = new Map();
  dataset = {};
  disabled = false;
  setAttribute(name, value) { this.attributes.set(name, value); }
}

test('the panel cancels a local color preview on a foreign lock and removes listeners on dispose', () => {
  const elements = new Map();
  const querySelector = (selector) => {
    if (!elements.has(selector)) elements.set(selector, new Control());
    return elements.get(selector);
  };
  querySelector('#scene-object-list').querySelectorAll = () => [];
  let visualColor = '#6c8cff';
  const entity = {
    id: 'box',
    type: 'box',
    color: '#6c8cff',
    materialMode: 'solid',
    animation: { enabled: true, axis: 'y', speed: 45 },
    mesh: { material: { color: { set(value) { visualColor = value; } } } },
  };
  const committed = [];
  let locked = false;
  let editable;
  const panel = createControlsPanel({ querySelector, querySelectorAll: () => [] }, {
    getSelectedEntity: () => entity,
    setSelectedEntityEditable(value) { editable = value; },
    hasCopiedProperties: () => false,
    setColor(value) { committed.push(value); },
  }, {
    isLocked: () => locked,
  });
  const input = querySelector('#custom-object-color');
  const preview = (value) => {
    input.value = value;
    input.dispatchEvent(new Event('input'));
  };

  panel.syncSelectedEntity();
  preview('#ff0000');
  assert.equal(visualColor, '#ff0000');
  locked = true;
  panel.syncSelectedEntity();
  assert.equal(visualColor, entity.color);
  assert.equal(editable, false);
  assert.equal(input.disabled, true);
  input.dispatchEvent(new Event('change'));
  assert.deepEqual(committed, []);

  locked = false;
  panel.syncSelectedEntity();
  preview('#00ff00');
  panel.dispose();
  assert.equal(visualColor, entity.color);
  preview('#ffffff');
  input.dispatchEvent(new Event('change'));
  assert.equal(visualColor, entity.color);
  assert.deepEqual(committed, []);
});
