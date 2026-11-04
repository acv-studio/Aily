import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Cloud, CloudDrizzle, CloudLightning, CloudRain, CloudSnow, LocateFixed, RefreshCw, Search, Sun, Moon, Wind } from 'lucide-react'
import { useI18n } from './i18n'
import './weather.css'

type Place = { name: string; latitude: number; longitude: number; admin1?: string; country?: string }
type Weather = { temperature: number; feelsLike: number; code: number; isDay: boolean; wind: number; updatedAt: string }
type Failure = 'network' | 'notFound' | 'denied' | 'location'
type Request = { kind: 'search'; city: string } | { kind: 'weather'; place: Place } | { kind: 'location' }

const copy = {
  'zh-CN': { title: '当前天气', updated: '更新', disclosure: '查询时，城市或坐标会发送至 Open-Meteo', empty: '选择城市，看看此刻天气', locate: '使用当前位置', city: '搜索城市', placeholder: '输入城市名称', search: '搜索', loading: '正在获取天气…', locating: '正在定位…', searching: '正在搜索城市…', retry: '重试', change: '更换城市', feels: '体感', wind: '风速', source: '天气数据：Open-Meteo', current: '当前位置', network: '天气暂时不可用，请重试', notFound: '未找到城市，请换个名称', denied: '定位被拒绝，请手动搜索城市', location: '无法定位，请手动搜索城市', clear: '晴', mainlyClear: '大部晴朗', partlyCloudy: '局部多云', cloudy: '阴', fog: '雾', drizzle: '毛毛雨', rain: '雨', snow: '雪', showers: '阵雨', snowShowers: '阵雪', thunder: '雷雨', unknown: '天气代码' },
  en: { title: 'Current weather', updated: 'Updated', disclosure: 'City or coordinates are sent to Open-Meteo when you request weather', empty: 'Choose a city for current weather', locate: 'Use my location', city: 'Search city', placeholder: 'Enter city name', search: 'Search', loading: 'Loading weather…', locating: 'Finding your location…', searching: 'Searching cities…', retry: 'Retry', change: 'Change city', feels: 'Feels like', wind: 'Wind', source: 'Weather data: Open-Meteo', current: 'Current location', network: 'Weather unavailable. Please retry', notFound: 'City not found. Try another name', denied: 'Location denied. Search a city instead', location: 'Location unavailable. Search a city instead', clear: 'Clear', mainlyClear: 'Mainly clear', partlyCloudy: 'Partly cloudy', cloudy: 'Overcast', fog: 'Fog', drizzle: 'Drizzle', rain: 'Rain', snow: 'Snow', showers: 'Rain showers', snowShowers: 'Snow showers', thunder: 'Thunderstorm', unknown: 'Weather code' },
}

function condition(code: number) {
  if (code === 0) return { key: 'clear', Icon: Sun } as const
  if (code === 1) return { key: 'mainlyClear', Icon: Sun } as const
  if (code === 2) return { key: 'partlyCloudy', Icon: Cloud } as const
  if (code === 3) return { key: 'cloudy', Icon: Cloud } as const
  if ([45, 48].includes(code)) return { key: 'fog', Icon: Cloud } as const
  if ([51, 53, 55, 56, 57].includes(code)) return { key: 'drizzle', Icon: CloudDrizzle } as const
  if ([61, 63, 65, 66, 67].includes(code)) return { key: 'rain', Icon: CloudRain } as const
  if ([71, 73, 75, 77].includes(code)) return { key: 'snow', Icon: CloudSnow } as const
  if ([80, 81, 82].includes(code)) return { key: 'showers', Icon: CloudRain } as const
  if ([85, 86].includes(code)) return { key: 'snowShowers', Icon: CloudSnow } as const
  if ([95, 96, 99].includes(code)) return { key: 'thunder', Icon: CloudLightning } as const
  return { key: 'unknown', Icon: Cloud } as const
}

const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value)
function validPlace(value: unknown): value is Place {
  if (!value || typeof value !== 'object') return false
  const place = value as Place
  return typeof place.name === 'string' && finite(place.latitude) && Math.abs(place.latitude) <= 90 && finite(place.longitude) && Math.abs(place.longitude) <= 180
}

export default function WeatherWidget() {
  const { locale } = useI18n()
  const text = copy[locale]
  const [city, setCity] = useState('')
  const [searchOpen, setSearchOpen] = useState(false)
  const [places, setPlaces] = useState<Place[]>([])
  const [place, setPlace] = useState<Place | null>(null)
  const [weather, setWeather] = useState<Weather | null>(null)
  const [busy, setBusy] = useState<'weather' | 'search' | 'location' | null>(null)
  const [failure, setFailure] = useState<Failure | null>(null)
  const controller = useRef<AbortController | null>(null)
  const generation = useRef(0)
  const lastRequest = useRef<Request | null>(null)

  useEffect(() => () => { generation.current++; controller.current?.abort() }, [])

  function start(request: Request) {
    controller.current?.abort()
    const next = new AbortController()
    controller.current = next
    const id = ++generation.current
    lastRequest.current = request
    setFailure(null)
    setWeather(null)
    setPlaces([])
    return { signal: next.signal, id }
  }

  async function loadWeather(selected: Place) {
    const { signal, id } = start({ kind: 'weather', place: selected })
    setPlace(selected)
    setBusy('weather')
    setSearchOpen(false)
    try {
      const params = new URLSearchParams({ latitude: String(selected.latitude), longitude: String(selected.longitude), current: 'temperature_2m,apparent_temperature,weather_code,is_day,wind_speed_10m', timezone: 'auto', temperature_unit: 'celsius', wind_speed_unit: 'kmh' })
      const response = await fetch(`https://api.open-meteo.com/v1/forecast?${params}`, { signal })
      if (!response.ok) throw new Error('Weather request failed')
      const data = await response.json()
      const current = data?.current
      if (!current || !finite(current.temperature_2m) || !finite(current.apparent_temperature) || !finite(current.weather_code) || !finite(current.wind_speed_10m) || ![0, 1].includes(current.is_day) || typeof current.time !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(current.time)) throw new Error('Invalid weather data')
      if (id !== generation.current) return
      setWeather({ temperature: current.temperature_2m, feelsLike: current.apparent_temperature, code: current.weather_code, isDay: current.is_day === 1, wind: current.wind_speed_10m, updatedAt: current.time })
    } catch {
      if (id === generation.current && !signal.aborted) setFailure('network')
    } finally {
      if (id === generation.current) setBusy(null)
    }
  }

  async function searchCity(query: string) {
    const trimmed = query.trim()
    if (!trimmed) return
    const { signal, id } = start({ kind: 'search', city: trimmed })
    setBusy('search')
    try {
      const params = new URLSearchParams({ name: trimmed, count: '5', language: locale === 'en' ? 'en' : 'zh', format: 'json' })
      const response = await fetch(`https://geocoding-api.open-meteo.com/v1/search?${params}`, { signal })
      if (!response.ok) throw new Error('City request failed')
      const data = await response.json()
      if (id !== generation.current) return
      const matches: Place[] = Array.isArray(data?.results) ? data.results.filter(validPlace) : []
      if (!matches.length) setFailure('notFound')
      else if (matches.length === 1) { void loadWeather(matches[0]); return }
      else setPlaces(matches)
    } catch {
      if (id === generation.current && !signal.aborted) setFailure('network')
    } finally {
      if (id === generation.current) setBusy(null)
    }
  }

  function locate() {
    const { id } = start({ kind: 'location' })
    setBusy('location')
    if (!navigator.geolocation) {
      setBusy(null); setFailure('location'); setSearchOpen(true); return
    }
    navigator.geolocation.getCurrentPosition(position => {
      if (id !== generation.current) return
      const selected = { name: text.current, latitude: position.coords.latitude, longitude: position.coords.longitude }
      if (!validPlace(selected)) { setBusy(null); setFailure('location'); setSearchOpen(true); return }
      void loadWeather(selected)
    }, error => {
      if (id !== generation.current) return
      setBusy(null); setFailure(error.code === 1 ? 'denied' : 'location'); setSearchOpen(true)
    }, { enableHighAccuracy: false, timeout: 10000, maximumAge: 300000 })
  }

  function retry() {
    const request = lastRequest.current
    if (request?.kind === 'weather') void loadWeather(request.place)
    else if (request?.kind === 'search') void searchCity(request.city)
    else if (request?.kind === 'location') locate()
  }

  function openSearch() {
    generation.current++; controller.current?.abort()
    setBusy(null); setFailure(null); setPlaces([]); setSearchOpen(true)
  }

  function submit(event: FormEvent) { event.preventDefault(); void searchCity(city) }
  const details = weather ? condition(weather.code) : null
  const Icon = details?.key === 'clear' && !weather?.isDay ? Moon : details?.Icon ?? Cloud

  return <section className="weather-widget" aria-label={text.title} aria-busy={busy !== null}>
    <header className="weather-widget-header"><span>{text.title}</span>{weather && <button type="button" className="weather-icon-button" onClick={() => place && void loadWeather(place)} aria-label={text.retry}><RefreshCw size={12} aria-hidden="true" /></button>}</header>
    {weather && place && details ? <div className="weather-current">
      <span className="weather-place" title={place.name}>{place.name}</span>
      <div className="weather-temperature"><Icon size={31} strokeWidth={1.5} aria-hidden="true" /><strong>{Math.round(weather.temperature)}<small>°C</small></strong></div>
      <span className="weather-condition">{text[details.key]}{details.key === 'unknown' ? ` ${weather.code}` : ''}</span>
      <div className="weather-metrics"><span>{text.feels} {Math.round(weather.feelsLike)}°</span><span><Wind size={11} aria-hidden="true" />{text.wind} {Math.round(weather.wind)} km/h</span></div>
    </div> : <div className="weather-placeholder">
      <Cloud size={28} strokeWidth={1.4} aria-hidden="true" />
      {busy ? <p role="status">{busy === 'location' ? text.locating : busy === 'search' ? text.searching : text.loading}</p> : failure ? <p role="alert">{text[failure]}</p> : <p>{text.empty}</p>}
      {failure && <button type="button" className="weather-retry" onClick={retry}>{text.retry}</button>}
    </div>}
    {searchOpen && <form className="weather-search" onSubmit={submit}>
      <input aria-label={text.city} placeholder={text.placeholder} value={city} onChange={event => setCity(event.target.value)} maxLength={100} />
      <button type="submit" className="weather-icon-button" disabled={!city.trim() || busy !== null} aria-label={text.search}><Search size={14} aria-hidden="true" /></button>
    </form>}
    {places.length > 0 && <ul className="weather-results">{places.map((match, index) => <li key={`${match.latitude}:${match.longitude}:${index}`}><button type="button" onClick={() => void loadWeather(match)}>{match.name}<small>{[match.admin1, match.country].filter(value => typeof value === 'string').join(' · ')}</small></button></li>)}</ul>}
    <div className="weather-actions"><button type="button" onClick={locate} disabled={busy !== null}><LocateFixed size={12} aria-hidden="true" />{text.locate}</button><button type="button" onClick={openSearch}>{weather ? text.change : text.city}</button></div>
    {weather ? <time className="weather-updated" dateTime={weather.updatedAt}>{text.updated} {weather.updatedAt.slice(5, 16).replace('T', ' ')}</time> : <p className="weather-disclosure">{text.disclosure}</p>}
    {weather && <a className="weather-source" href="https://open-meteo.com/" target="_blank" rel="noreferrer">{text.source}</a>}
  </section>
}
