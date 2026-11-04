import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import WeatherWidget from './WeatherWidget'
import { setLocale } from './i18n'

const fetchMock = vi.fn()
const getPosition = vi.fn()
const shanghai = { name: '上海', latitude: 31.22, longitude: 121.46, country: '中国' }
const response = (data: unknown, ok = true) => ({ ok, json: async () => data })
const current = { current: { time: '2026-11-04T14:45', temperature_2m: 21.4, apparent_temperature: 20.1, weather_code: 2, is_day: 1, wind_speed_10m: 8.2 } }

beforeEach(() => {
  setLocale('zh-CN')
  fetchMock.mockReset()
  getPosition.mockReset()
  vi.stubGlobal('fetch', fetchMock)
  vi.stubGlobal('navigator', { geolocation: { getCurrentPosition: getPosition } })
})
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

function search(city = '上海') {
  fireEvent.click(screen.getByRole('button', { name: '搜索城市' }))
  fireEvent.change(screen.getByRole('textbox', { name: '搜索城市' }), { target: { value: city } })
  fireEvent.click(screen.getByRole('button', { name: '搜索' }))
}

describe('WeatherWidget', () => {
  it('does not request location, fetch or invent temperatures on mount', () => {
    render(<WeatherWidget />)
    expect(screen.getByText('选择城市，看看此刻天气')).toBeInTheDocument()
    expect(getPosition).not.toHaveBeenCalled()
    expect(fetchMock).not.toHaveBeenCalled()
    expect(screen.queryByText(/°C/)).not.toBeInTheDocument()
  })

  it('geocodes an explicit city search and requests real current weather with timezone auto', async () => {
    fetchMock.mockResolvedValueOnce(response({ results: [shanghai] })).mockResolvedValueOnce(response(current))
    const persist = vi.spyOn(Storage.prototype, 'setItem')
    render(<WeatherWidget />)
    search()
    expect(await screen.findByText('局部多云')).toBeInTheDocument()
    expect(screen.getByText('21')).toHaveTextContent('21°C')
    expect(screen.getByText('体感 20°')).toBeInTheDocument()
    expect(screen.getByText('更新 11-04 14:45')).toHaveAttribute('dateTime', '2026-11-04T14:45')
    const geocoding = new URL(fetchMock.mock.calls[0][0])
    expect(geocoding.hostname).toBe('geocoding-api.open-meteo.com')
    expect(geocoding.searchParams.get('name')).toBe('上海')
    expect(geocoding.searchParams.get('language')).toBe('zh')
    const forecast = new URL(fetchMock.mock.calls[1][0])
    expect(forecast.hostname).toBe('api.open-meteo.com')
    expect(forecast.searchParams.get('timezone')).toBe('auto')
    expect(forecast.searchParams.get('latitude')).toBe('31.22')
    expect(forecast.searchParams.get('current')).toContain('temperature_2m')
    expect(getPosition).not.toHaveBeenCalled()
    expect(persist).not.toHaveBeenCalled()
    persist.mockRestore()
  })

  it('offers city choices instead of silently choosing an ambiguous result', async () => {
    fetchMock.mockResolvedValueOnce(response({ results: [shanghai, { name: '上海县', latitude: 32, longitude: 120, country: '中国' }] })).mockResolvedValueOnce(response(current))
    render(<WeatherWidget />)
    search()
    fireEvent.click(await screen.findByRole('button', { name: /上海县/ }))
    await screen.findByText('局部多云')
    expect(new URL(fetchMock.mock.calls[1][0]).searchParams.get('latitude')).toBe('32')
  })

  it('allows manual search when explicit geolocation is denied', async () => {
    getPosition.mockImplementation((_success, error) => error({ code: 1 }))
    render(<WeatherWidget />)
    fireEvent.click(screen.getByRole('button', { name: '使用当前位置' }))
    expect(getPosition).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('alert')).toHaveTextContent('定位被拒绝，请手动搜索城市')
    expect(screen.getByRole('textbox', { name: '搜索城市' })).toBeInTheDocument()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('fetches the user coordinates only after the location button is clicked', async () => {
    getPosition.mockImplementation(success => success({ coords: { latitude: 40, longitude: -74 } }))
    fetchMock.mockResolvedValue(response(current))
    render(<WeatherWidget />)
    fireEvent.click(screen.getByRole('button', { name: '使用当前位置' }))
    await screen.findByText('局部多云')
    expect(screen.getByText('当前位置')).toBeInTheDocument()
    expect(new URL(fetchMock.mock.calls[0][0]).searchParams.get('longitude')).toBe('-74')
    expect(getPosition.mock.calls[0][2]).toMatchObject({ enableHighAccuracy: false, timeout: 10000 })
  })

  it('shows fetch errors without fabricated weather and retries the same request', async () => {
    fetchMock.mockResolvedValueOnce(response({ results: [shanghai] })).mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(response(current))
    render(<WeatherWidget />)
    search()
    expect(await screen.findByRole('alert')).toHaveTextContent('天气暂时不可用，请重试')
    expect(screen.queryByText(/°C/)).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '重试' }))
    await screen.findByText('局部多云')
    expect(fetchMock.mock.calls[2][0]).toBe(fetchMock.mock.calls[1][0])
  })

  it('reports no geocoding results and rejects malformed current weather', async () => {
    fetchMock.mockResolvedValueOnce(response({ results: [] }))
    render(<WeatherWidget />)
    search()
    expect(await screen.findByRole('alert')).toHaveTextContent('未找到城市')
    fetchMock.mockResolvedValueOnce(response({ results: [shanghai] })).mockResolvedValueOnce(response({ current: { time: '2026-11-04T14:45', temperature_2m: null } }))
    fireEvent.click(screen.getByRole('button', { name: '搜索' }))
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('天气暂时不可用'))
    expect(screen.queryByText(/°C/)).not.toBeInTheDocument()
  })

  it('shows loading and aborts an in-flight fetch on unmount', () => {
    fetchMock.mockImplementation(() => new Promise(() => {}))
    const view = render(<WeatherWidget />)
    search()
    expect(screen.getByRole('status')).toHaveTextContent('正在搜索城市')
    const signal = fetchMock.mock.calls[0][1].signal as AbortSignal
    expect(signal.aborted).toBe(false)
    view.unmount()
    expect(signal.aborted).toBe(true)
  })

  it('aborts a forecast request on unmount and ignores its late result', async () => {
    let finish!: (value: unknown) => void
    fetchMock.mockResolvedValueOnce(response({ results: [shanghai] })).mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
    const view = render(<WeatherWidget />)
    search()
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
    expect(screen.getByRole('status')).toHaveTextContent('正在获取天气')
    const signal = fetchMock.mock.calls[1][1].signal as AbortSignal
    view.unmount()
    expect(signal.aborted).toBe(true)
    await act(async () => { finish(response(current)) })
    expect(screen.queryByText('局部多云')).not.toBeInTheDocument()
  })

  it('ignores a cancelled city search result when the user starts a new search', async () => {
    let finish!: (value: unknown) => void
    fetchMock.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
    render(<WeatherWidget />)
    search()
    const signal = fetchMock.mock.calls[0][1].signal as AbortSignal
    fireEvent.click(screen.getByRole('button', { name: '搜索城市' }))
    expect(signal.aborted).toBe(true)
    await act(async () => { finish(response({ results: [shanghai] })) })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  it('offers manual search when browser geolocation is unavailable', () => {
    vi.stubGlobal('navigator', {})
    render(<WeatherWidget />)
    fireEvent.click(screen.getByRole('button', { name: '使用当前位置' }))
    expect(screen.getByRole('alert')).toHaveTextContent('无法定位，请手动搜索城市')
    expect(screen.getByRole('textbox', { name: '搜索城市' })).toBeInTheDocument()
  })

  it('ignores a geolocation callback arriving after unmount', () => {
    const view = render(<WeatherWidget />)
    fireEvent.click(screen.getByRole('button', { name: '使用当前位置' }))
    const callback = getPosition.mock.calls[0][0]
    view.unmount()
    act(() => callback({ coords: { latitude: 40, longitude: -74 } }))
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('uses inline English labels when the application locale is English', async () => {
    setLocale('en')
    fetchMock.mockResolvedValueOnce(response({ results: [shanghai] })).mockResolvedValueOnce(response(current))
    render(<WeatherWidget />)
    expect(screen.getByRole('region', { name: 'Current weather' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Search city' }))
    fireEvent.change(screen.getByRole('textbox', { name: 'Search city' }), { target: { value: 'Shanghai' } })
    fireEvent.click(screen.getByRole('button', { name: 'Search' }))
    expect(await screen.findByText('Partly cloudy')).toBeInTheDocument()
    expect(new URL(fetchMock.mock.calls[0][0]).searchParams.get('language')).toBe('en')
  })
})
