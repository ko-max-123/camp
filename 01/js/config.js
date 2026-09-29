export const CONFIG = {
  forecastDays: 16,
  historicalYears: 5,
  maxCandidateDays: 5,
  weatherHourly: [
    "temperature_2m",
    "apparent_temperature",
    "relative_humidity_2m",
    "dew_point_2m",
    "precipitation",
    "precipitation_probability",
    "weather_code",
    "wind_speed_10m",
    "wind_gusts_10m",
    "shortwave_radiation"
  ],
  historicalHourly: [
    "temperature_2m",
    "apparent_temperature",
    "relative_humidity_2m",
    "dew_point_2m",
    "precipitation",
    "weather_code",
    "wind_speed_10m",
    "wind_gusts_10m",
    "shortwave_radiation"
  ],
  geocode: {
    nominatim: "https://nominatim.openstreetmap.org/search",
    openMeteo: "https://geocoding-api.open-meteo.com/v1/search"
  },
  forecastApi: "https://api.open-meteo.com/v1/forecast",
  archiveApi: "https://archive-api.open-meteo.com/v1/archive"
};
