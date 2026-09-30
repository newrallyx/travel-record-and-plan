import assert from 'node:assert/strict'
import test from 'node:test'

import {
  getUnresolvedNamedWaypoints,
  hasResolvedWaypointCoordinate,
} from '../src/utils/waypointValidation.ts'

test('named waypoints without valid coordinates are blocked from route planning', () => {
  const resolved = { id: 'resolved', name: 'Resolved', lat: 30.5, lng: 104.1 }
  const missing = { id: 'missing', name: 'Missing' }
  const invalid = { id: 'invalid', name: 'Invalid', lat: 95, lng: 104.1 }
  const unnamed = { id: 'unnamed', name: '  ' }

  assert.equal(hasResolvedWaypointCoordinate(resolved), true)
  assert.equal(hasResolvedWaypointCoordinate(invalid), false)
  assert.deepEqual(
    getUnresolvedNamedWaypoints([resolved, missing, invalid, unnamed]).map((waypoint) => waypoint.id),
    ['missing', 'invalid'],
  )
})
