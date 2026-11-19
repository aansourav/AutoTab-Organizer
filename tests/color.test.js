import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  GROUP_COLORS,
  chromeColorFor,
  normalizeColor,
  parseColor,
  rgbFromHex,
} from '../src/color.js'

test('hex, shorthand, rgb, and saved chrome names become one hex color', () => {
  assert.equal(parseColor('#ff00aa'), '#ff00aa')
  assert.equal(parseColor('FF00AA'), '#ff00aa')
  assert.equal(parseColor('#f0a'), '#ff00aa')
  assert.equal(parseColor('#ff00aa80'), '#ff00aa')
  assert.equal(parseColor('rgb(255, 0, 170)'), '#ff00aa')
  assert.equal(parseColor('rgb(255 0 170)'), '#ff00aa')
  assert.equal(parseColor('rgba(255, 0, 170, 0.4)'), '#ff00aa')
  assert.equal(parseColor('255, 0, 170'), '#ff00aa')
  assert.equal(parseColor('red'), '#d93025')
  assert.equal(parseColor('nope'), undefined)
  assert.equal(parseColor('rgb(300, 0, 0)'), undefined)
  assert.equal(normalizeColor('nope'), '#5f6368')
  assert.deepEqual(rgbFromHex('#ff00aa'), { r: 255, g: 0, b: 170 })
})

test('every chrome swatch maps back to itself, and primaries pick a neighbor', () => {
  for (const color of GROUP_COLORS) {
    assert.equal(chromeColorFor(color.swatch), color.id)
    assert.equal(chromeColorFor(color.id), color.id)
  }

  assert.equal(chromeColorFor('#ffffff'), 'grey')
  assert.equal(chromeColorFor('#000000'), 'grey')
  assert.equal(chromeColorFor('#808080'), 'grey')
  assert.equal(chromeColorFor('#ff0000'), 'red')
  assert.equal(chromeColorFor('#00ff00'), 'green')
  assert.equal(chromeColorFor('#0000ff'), 'blue')
  assert.equal(chromeColorFor('#ffff00'), 'yellow')
  assert.equal(chromeColorFor('#ff8800'), 'orange')
  assert.equal(chromeColorFor('#00ffff'), 'cyan')
  assert.equal(chromeColorFor('#ff00ff'), 'pink')
  assert.equal(chromeColorFor('#ff00aa'), 'pink')
})
