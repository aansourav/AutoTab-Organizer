import assert from 'node:assert/strict'
import { test } from 'node:test'
import { UNGROUPED_TAB_GROUP_ID } from '../src/matcher.js'
import { planWindowOrganization } from '../src/planner.js'
import { defaultRules } from '../src/rules.js'

const rules = defaultRules()
const domainOn = { autoGroupByDomain: true, domainThreshold: 2 }
const domainOff = { autoGroupByDomain: false, domainThreshold: 2 }

const tab = (overrides) => ({
  id: 1,
  windowId: 1,
  pinned: false,
  groupId: UNGROUPED_TAB_GROUP_ID,
  active: false,
  url: 'https://example.com/',
  ...overrides,
})

const plan = (overrides) =>
  planWindowOrganization({
    tabs: [],
    groups: [],
    rules,
    settings: domainOff,
    windowId: 1,
    mode: 'all',
    ...overrides,
  })

test('organize all batches matching tabs and skips ones already in the right group', () => {
  const result = plan({
    tabs: [
      tab({ id: 1, url: 'https://www.youtube.com/watch?v=1' }),
      tab({ id: 2, url: 'https://youtu.be/abc' }),
      tab({ id: 3, url: 'https://reddit.com/r/chrome' }),
      tab({ id: 4, url: 'https://youtube.com', groupId: 8 }),
      tab({ id: 5, pinned: true, url: 'https://youtube.com' }),
      tab({ id: 6, url: 'chrome://newtab' }),
    ],
    groups: [
      { id: 8, windowId: 1, title: 'YouTube' },
      { id: 9, windowId: 1, title: 'Social' },
    ],
  })

  assert.deepEqual(result.groups, [
    {
      key: 'rule:rule-youtube',
      title: 'YouTube',
      color: 'red',
      autoCollapse: false,
      priority: 0,
      tabIds: [1, 2],
      existingGroupId: 8,
    },
    {
      key: 'rule:rule-social',
      title: 'Social',
      color: 'blue',
      autoCollapse: false,
      priority: 1,
      tabIds: [3],
      existingGroupId: 9,
    },
  ])
})

test('a tab that navigates to a new rule leaves its old group', () => {
  const result = plan({
    mode: 'touched',
    tabIds: [1],
    tabs: [
      tab({ id: 1, url: 'https://github.com/org/repo', groupId: 4 }),
      tab({ id: 2, url: 'https://reddit.com', groupId: 4 }),
    ],
    groups: [{ id: 4, windowId: 1, title: 'Social' }],
  })

  assert.deepEqual(result.groups.map((group) => ({ title: group.title, tabIds: group.tabIds })), [
    { title: 'Dev', tabIds: [1] },
  ])
})

test('realtime updates do not pull unrelated tabs', () => {
  const result = plan({
    mode: 'touched',
    tabIds: [1],
    tabs: [
      tab({ id: 1, url: 'https://youtube.com' }),
      tab({ id: 2, url: 'https://reddit.com' }),
    ],
  })

  assert.deepEqual(result.groups.map((group) => group.tabIds), [[1]])
})

test('an empty realtime burst does not organize the window', () => {
  const result = plan({
    mode: 'touched',
    tabIds: [],
    tabs: [tab({ id: 1, url: 'https://youtube.com' })],
  })

  assert.deepEqual(result.groups, [])
})

test('groups in another window are not reused', () => {
  const result = plan({
    tabs: [tab({ id: 1, url: 'https://youtube.com' })],
    groups: [{ id: 4, windowId: 2, title: 'YouTube' }],
  })

  assert.equal(result.groups[0].existingGroupId, null)
  assert.deepEqual(result.groups[0].tabIds, [1])
})

test('duplicate titles reuse the oldest group in this window', () => {
  const result = plan({
    tabs: [tab({ id: 1, url: 'https://youtube.com' })],
    groups: [
      { id: 9, windowId: 1, title: 'YouTube' },
      { id: 3, windowId: 1, title: 'YouTube' },
    ],
  })

  assert.equal(result.groups[0].existingGroupId, 3)
})

test('auto-domain grouping waits for the threshold and names the site', () => {
  const one = plan({
    settings: domainOn,
    tabs: [tab({ id: 1, url: 'https://www.amazon.com/dp/1' })],
  })
  assert.deepEqual(one.groups, [])

  const two = plan({
    settings: domainOn,
    tabs: [
      tab({ id: 1, url: 'https://www.amazon.com/dp/1' }),
      tab({ id: 2, url: 'https://smile.amazon.com/dp/2' }),
      tab({ id: 3, url: 'https://ebay.com/itm/1' }),
    ],
  })

  assert.equal(two.groups.length, 1)
  assert.equal(two.groups[0].title, 'Amazon')
  assert.deepEqual(two.groups[0].tabIds, [1, 2])
  assert.equal(two.groups[0].key, 'domain:amazon.com')
})

test('custom rules beat the domain fallback', () => {
  const result = plan({
    settings: domainOn,
    tabs: [
      tab({ id: 1, url: 'https://mail.google.com/mail/u/0' }),
      tab({ id: 2, url: 'https://mail.google.com/mail/u/1' }),
    ],
  })

  assert.equal(result.groups.length, 1)
  assert.equal(result.groups[0].title, 'Email')
})

test('pinned tabs do not count toward the domain threshold', () => {
  const result = plan({
    settings: domainOn,
    tabs: [
      tab({ id: 1, pinned: true, url: 'https://amazon.com/dp/1' }),
      tab({ id: 2, url: 'https://amazon.com/dp/2' }),
    ],
  })

  assert.deepEqual(result.groups, [])
})

test('opening the second matching tab pulls ungrouped siblings only', () => {
  const result = plan({
    settings: domainOn,
    mode: 'touched',
    tabIds: [2],
    tabs: [
      tab({ id: 1, url: 'https://amazon.com/dp/1', groupId: 5 }),
      tab({ id: 2, url: 'https://amazon.com/dp/2' }),
      tab({ id: 3, url: 'https://amazon.com/dp/3' }),
    ],
    groups: [{ id: 5, windowId: 1, title: 'Shopping' }],
  })

  assert.deepEqual(result.groups[0].tabIds, [2, 3])
  assert.equal(result.groups[0].title, 'Amazon')
})

test('a sibling already in the domain group is left alone', () => {
  const result = plan({
    settings: domainOn,
    mode: 'touched',
    tabIds: [2],
    tabs: [
      tab({ id: 1, url: 'https://amazon.com/dp/1', groupId: 5 }),
      tab({ id: 2, url: 'https://amazon.com/dp/2' }),
    ],
    groups: [{ id: 5, windowId: 1, title: 'Amazon' }],
  })

  assert.deepEqual(result.groups[0].tabIds, [2])
  assert.equal(result.groups[0].existingGroupId, 5)
})

test('rule priority is the array order stored on the rule', () => {
  const result = plan({
    rules: [
      { id: 'late', name: 'Late', color: 'grey', patterns: ['*.google.com'], priority: 2, autoCollapse: false },
      { id: 'early', name: 'Early', color: 'green', patterns: ['docs.google.com'], priority: 0, autoCollapse: true },
    ],
    tabs: [tab({ id: 1, url: 'https://docs.google.com/document/d/1' })],
  })

  assert.equal(result.groups[0].title, 'Early')
  assert.equal(result.groups[0].autoCollapse, true)
})
