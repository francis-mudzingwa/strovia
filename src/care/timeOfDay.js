// Time of day for exercises and daily tasks (the database enforces the same rule in Eastern time).
//  - A PM exercise opens at 12 noon.
//  - A daily task can be tagged in the care plan: Morning and "any time" are always open, Afternoon opens at 12 noon, Evening at 5 PM.
//  - Medication is NOT limited by time: a patient may need a dose at any hour.
export const WHEN_OPTIONS = [["", "Any time"], ["morning", "Morning"], ["afternoon", "Afternoon"], ["evening", "Evening"]]
export const WHEN_LABEL = { morning: "Morning", afternoon: "Afternoon", evening: "Evening" }
export const OPENS_AT = { afternoon: 12, evening: 17 }
export const PM_EXERCISE_OPENS = 12

export const hourText = (h) => (h === 12 ? "12 noon" : `${h % 12 || 12} ${h < 12 ? "AM" : "PM"}`)

// The hour a task opens (0 = always open).
export const taskOpensAt = (taskTimes, task) => OPENS_AT[(taskTimes || {})[task]] || 0

// Is it still before `hour` on this device's clock? (0 or less never waits.)
export const isBefore = (now, hour) => hour > 0 && now.getHours() < hour
