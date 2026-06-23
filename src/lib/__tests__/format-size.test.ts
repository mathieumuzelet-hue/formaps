import { formatFileSize } from '../format-size'

describe('formatFileSize', () => {
  it('returns "0 o" for zero', () => {
    expect(formatFileSize(0)).toBe('0 o')
  })

  it('returns "0 o" for negative values', () => {
    expect(formatFileSize(-100)).toBe('0 o')
    expect(formatFileSize(-1048576)).toBe('0 o')
  })

  it('returns "0 o" for NaN', () => {
    expect(formatFileSize(NaN)).toBe('0 o')
  })

  it('returns "0 o" for Infinity', () => {
    expect(formatFileSize(Infinity)).toBe('0 o')
  })

  it('formats bytes correctly', () => {
    expect(formatFileSize(1)).toBe('1 o')
    expect(formatFileSize(512)).toBe('512 o')
    expect(formatFileSize(1023)).toBe('1023 o')
  })

  it('formats Ko correctly', () => {
    expect(formatFileSize(1024)).toBe('1,0 Ko')
    expect(formatFileSize(1536)).toBe('1,5 Ko')
    expect(formatFileSize(1048575)).toBe('1024,0 Ko')
  })

  it('formats Mo correctly', () => {
    expect(formatFileSize(1048576)).toBe('1,0 Mo')
    expect(formatFileSize(1572864)).toBe('1,5 Mo')
  })

  it('formats Go correctly', () => {
    expect(formatFileSize(1073741824)).toBe('1,0 Go')
    expect(formatFileSize(1610612736)).toBe('1,5 Go')
  })

  it('formats To correctly', () => {
    expect(formatFileSize(1099511627776)).toBe('1,0 To')
    expect(formatFileSize(1649267441664)).toBe('1,5 To')
  })
})
