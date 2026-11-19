import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  colorForDomain,
  domainGroupTitle,
  findMatchingRule,
  isGroupableTab,
  isIgnoredUrl,
  patternMatchesUrl,
  registrableDomain,
  suggestedPattern,
  targetFromRule,
} from '../src/matcher.js'
import { isGroupColor, defaultRules } from '../src/rules.js'

const rules = defaultRules()

test('default rules match the built-in sites', () => {
  const matches = [
    ['https://www.youtube.com/watch?v=1', 'YouTube'],
    ['https://youtu.be/abc', 'YouTube'],
    ['https://m.youtube.com/feed', 'YouTube'],
    ['https://www.reddit.com/r/chrome', 'Social'],
    ['https://x.com/home', 'Social'],
    ['https://mail.google.com/mail/u/0/#inbox', 'Email'],
    ['https://mail.proton.me/u/0/inbox', 'Email'],
    ['https://docs.google.com/document/d/abc', 'Work & Docs'],
    ['https://app.slack.com/client/T123', 'Work & Docs'],
    ['https://github.com/org/repo', 'Dev'],
    ['http://localhost:3000/app', 'Dev'],
    ['http://127.0.0.1:5173/', 'Dev'],
  ]

  for (const [url, name] of matches) {
    assert.equal(findMatchingRule(url, rules)?.name, name, url)
  }
})

test('domain patterns do not leak into lookalike hosts', () => {
  assert.equal(patternMatchesUrl('youtube.com', 'https://notyoutube.com/watch'), false)
  assert.equal(patternMatchesUrl('youtube.com', 'https://youtube.com.evil.com/'), false)
  assert.equal(patternMatchesUrl('x.com', 'https://box.com/'), false)
  assert.equal(patternMatchesUrl('x.com', 'https://example.com/x.com'), false)
  assert.equal(patternMatchesUrl('127.0.0.1', 'http://127.0.0.10/'), false)
})

test('wildcard domains match subdomains and the apex only', () => {
  assert.equal(patternMatchesUrl('*.google.com', 'https://mail.google.com/mail'), true)
  assert.equal(patternMatchesUrl('*.google.com', 'https://a.b.google.com/'), true)
  assert.equal(patternMatchesUrl('*.google.com', 'https://google.com/search'), true)
  assert.equal(patternMatchesUrl('*.google.com', 'https://notgoogle.com/'), false)
  assert.equal(patternMatchesUrl('*.google.com', 'https://google.com.evil.org/'), false)
})

test('path patterns honor segment boundaries', () => {
  assert.equal(patternMatchesUrl('github.com/pulls', 'https://github.com/pulls/123'), true)
  assert.equal(patternMatchesUrl('github.com/pulls', 'https://www.github.com/pulls'), true)
  assert.equal(patternMatchesUrl('github.com/pulls', 'https://github.com/pulls-extra'), false)
  assert.equal(patternMatchesUrl('github.com/pulls', 'https://github.com/issues'), false)
  assert.equal(
    patternMatchesUrl('https://www.YouTube.com/watch?v=1', 'https://m.youtube.com/watch?v=abc'),
    true,
  )
  assert.equal(
    patternMatchesUrl('https://www.YouTube.com/watch?v=1', 'https://www.youtube.com/playlist?list=1'),
    false,
  )
})

test('keywords match the address and stay case-insensitive', () => {
  assert.equal(patternMatchesUrl('inbox', 'https://mail.google.com/mail/u/0/#inbox'), true)
  assert.equal(patternMatchesUrl('inbox', 'https://example.com/'), false)
  assert.equal(patternMatchesUrl('ab', 'https://example.com/ab'), false)
})

test('lower priority number wins when two rules match', () => {
  const overlapping = [
    { id: 'broad', name: 'Google', color: 'grey', patterns: ['*.google.com'], priority: 0 },
    { id: 'mail', name: 'Email', color: 'yellow', patterns: ['mail.google.com'], priority: 5 },
  ]
  assert.equal(findMatchingRule('https://mail.google.com/mail', overlapping)?.name, 'Google')

  overlapping[0].priority = 5
  overlapping[1].priority = 0
  assert.equal(findMatchingRule('https://mail.google.com/mail', overlapping)?.name, 'Email')
})

test('pinned, internal, and blank tabs are not groupable', () => {
  assert.equal(isGroupableTab({ id: 1, pinned: true, url: 'https://youtube.com' }), false)
  assert.equal(isGroupableTab({ id: 2, pinned: false, url: 'chrome://extensions' }), false)
  assert.equal(isGroupableTab({ id: 3, pinned: false, url: 'chrome-extension://abc/page.html' }), false)
  assert.equal(isGroupableTab({ id: 4, pinned: false, url: 'edge://settings' }), false)
  assert.equal(isGroupableTab({ id: 5, pinned: false, url: 'about:blank' }), false)
  assert.equal(isGroupableTab({ id: 6, pinned: false, url: '', pendingUrl: '' }), false)
  assert.equal(isGroupableTab({ id: 7, pinned: false, pendingUrl: 'https://youtube.com/watch' }), true)
  assert.equal(isIgnoredUrl('devtools://devtools/bundled/inspector.html'), true)
  assert.equal(isIgnoredUrl('view-source:https://example.com'), true)
})

test('registrable domains keep multi-part suffixes apart', () => {
  assert.equal(registrableDomain('www.amazon.com'), 'amazon.com')
  assert.equal(registrableDomain('smile.amazon.com'), 'amazon.com')
  assert.equal(registrableDomain('www.bbc.co.uk'), 'bbc.co.uk')
  assert.equal(registrableDomain('alice.github.io'), 'alice.github.io')
  assert.equal(registrableDomain('127.0.0.1'), '127.0.0.1')
  assert.equal(domainGroupTitle('www.amazon.com'), 'Amazon')
  assert.equal(domainGroupTitle('www.bbc.co.uk'), 'Bbc')
  assert.equal(domainGroupTitle('alice.github.io'), 'Alice')
})

test('suggested patterns stay specific on shared sites', () => {
  assert.equal(suggestedPattern('https://www.youtube.com/watch?v=1'), 'youtube.com')
  assert.equal(suggestedPattern('https://mail.google.com/mail/u/0'), 'mail.google.com')
  assert.equal(suggestedPattern('https://smile.amazon.com/dp/1'), 'smile.amazon.com')
  assert.equal(suggestedPattern('https://www.bbc.co.uk/news'), 'bbc.co.uk')
  assert.equal(suggestedPattern('http://localhost:3000/'), 'localhost')
  assert.equal(suggestedPattern('chrome://newtab'), undefined)
})

test('a custom rule color becomes the nearest chrome group color', () => {
  const target = targetFromRule({
    id: 'custom',
    name: 'Custom',
    color: '#ff00aa',
    autoCollapse: false,
    priority: 0,
  })
  assert.equal(target.color, 'pink')
  assert.equal(targetFromRule({ id: 'old', name: 'Old', color: 'red' }).color, 'red')
})

test('domain colors are stable chrome group colors', () => {
  const first = colorForDomain('amazon.com')
  assert.equal(colorForDomain('amazon.com'), first)
  assert.equal(isGroupColor(first), true)
  assert.equal(isGroupColor(colorForDomain('github.com')), true)
})
