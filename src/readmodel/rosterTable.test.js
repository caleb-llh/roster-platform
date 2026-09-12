import { describe, it, expect } from 'vitest'
import {
  buildExportColumns,
  buildExportHeader,
  buildExportRows,
  toCSV,
  toTSV,
} from './rosterTable'

describe('rosterTable', () => {
  const roles = ['vm', 'cam']

  describe('buildExportColumns', () => {
    it('orders all real roles first, then understudy columns', () => {
      const events = [
        { roster: [{ role: 'vm' }, { role: 'cam' }, { role: 'vm-understudy' }] },
      ]
      const { columns } = buildExportColumns(events, roles)
      expect(columns.map(c => c.label)).toEqual(['vm', 'cam', 'vm-understudy'])
    })

    it('widens to the MAX count of a duplicated role, with numbered labels', () => {
      const events = [
        { roster: [{ role: 'cam' }, { role: 'cam' }] }, // two cams
        { roster: [{ role: 'cam' }] },
      ]
      const { columns, maxCount } = buildExportColumns(events, roles)
      expect(maxCount.cam).toBe(2)
      const camCols = columns.filter(c => c.role === 'cam')
      expect(camCols.map(c => c.label)).toEqual(['cam', 'cam 2'])
      expect(camCols.map(c => c.index)).toEqual([0, 1])
    })

    it('appends roles present in data but absent from the catalog (real, then understudy last)', () => {
      const events = [
        { roster: [{ role: 'extra' }, { role: 'extra-understudy' }, { role: 'vm' }] },
      ]
      const { columns } = buildExportColumns(events, roles)
      const labels = columns.map(c => c.label)
      // catalog reals first (vm, cam absent from data so 0 cols), then extra real,
      // catalog understudy (none in data), then the trailing understudy column.
      expect(labels).toEqual(['vm', 'extra', 'extra-understudy'])
    })

    it('returns empty columns for no events', () => {
      expect(buildExportColumns([], roles).columns).toEqual([])
      expect(buildExportColumns(null, roles).columns).toEqual([])
    })
  })

  describe('buildExportHeader', () => {
    it('brackets the role columns with fixed metadata + issue columns', () => {
      const { columns } = buildExportColumns([{ roster: [{ role: 'vm' }] }], roles)
      expect(buildExportHeader(columns)).toEqual([
        'Date', 'Day', 'Reporting Time', 'Event Name', 'vm', 'Errors', 'Warnings',
      ])
    })
  })

  describe('buildExportRows', () => {
    const memberLabel = (id) => ({ john: 'John', jane: 'Jane' })[id] || id

    it('places each assignment in its role column and blanks empty cells with "-"', () => {
      const events = [
        {
          date: '2026-02-07', day_of_week: 'Sat', reporting_time: '9am', name: 'Service',
          roster: [{ role: 'vm', member_id: 'john' }],
        },
      ]
      const { columns } = buildExportColumns(events, roles)
      const rows = buildExportRows(events, columns, { validationResults: {}, memberLabel })
      // columns: vm(0). cam has no data → no column. Two trailing issue cols empty.
      expect(rows[0]).toEqual(['2026-02-07', 'Sat', '9am', 'Service', 'John', '', ''])
    })

    it('distributes duplicate-role assignments positionally across their columns', () => {
      const events = [
        {
          date: '2026-02-07', day_of_week: 'Sat', reporting_time: '9am', name: 'Service',
          roster: [{ role: 'cam', member_id: 'john' }, { role: 'cam', member_id: 'jane' }],
        },
      ]
      const { columns } = buildExportColumns(events, roles)
      const rows = buildExportRows(events, columns, { validationResults: {}, memberLabel })
      // columns: cam(0), cam(1) — John then Jane, positionally.
      expect(rows[0]).toEqual(['2026-02-07', 'Sat', '9am', 'Service', 'John', 'Jane', '', ''])
    })

    it('joins validation errors/warnings into the trailing columns', () => {
      const events = [
        { date: '2026-02-07', day_of_week: 'Sat', reporting_time: '9am', name: 'Service', roster: [] },
      ]
      const { columns } = buildExportColumns(events, roles)
      const validationResults = {
        '2026-02-07': { errors: ['e1', 'e2'], warnings: ['w1'] },
      }
      const rows = buildExportRows(events, columns, { validationResults, memberLabel })
      expect(rows[0][rows[0].length - 2]).toBe('e1; e2')
      expect(rows[0][rows[0].length - 1]).toBe('w1')
    })
  })

  describe('toCSV / toTSV', () => {
    const header = ['A', 'B']
    const rows = [['1', '2'], ['3', '4']]

    it('quotes every CSV cell and newline-joins', () => {
      expect(toCSV(header, rows)).toBe('A,B\n"1","2"\n"3","4"')
    })

    it('tab-joins TSV without quoting', () => {
      expect(toTSV(header, rows)).toBe('A\tB\n1\t2\n3\t4')
    })
  })
})
