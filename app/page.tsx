// @ts-nocheck
"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

/**
 * Fitness Tracker (Exercise + Nutrition)
 *
 * Features
 * - Workouts: searchable exercise library + free-text entries
 * - Resistance entries: sets with weight + reps
 * - Cardio entries: duration
 * - Date/time stamped workouts
 * - Nutrition: meal-based logging (Breakfast/Lunch/Dinner/Snack)
 * - Per-meal + daily macro totals
 * - Food lookup via USDA FoodData Central (BYO API key)
 * - Copy-forward: copy meals (whole day or per-meal) from prior day
 * - UX: independent search state per tab
 * - UX: quantity multiplier per food item (servings)
 * - UX: save free-text workout exercises into the library
 *
 * Notes on MyFitnessPal integration:
 * - MyFitnessPal's API is private/approved-developers-only, so direct integration isn't reliable.
 * - This app supports a broadly available alternative: USDA FoodData Central.
 */

// -------------------------
// Utilities
// -------------------------
const uid = () =>
  Math.random().toString(36).slice(2, 10) + "_" + Date.now().toString(36);

function fmtDateTime(dt: string | number | Date | null | undefined): string {
  try {
    if (dt == null) return "";
    return new Date(dt).toLocaleString();
  } catch {
    return String(dt);
  }
}

function isoDateFromInput(dateStr) {
  return new Date(`${dateStr}T00:00:00`).toISOString();
}

function sameDayISO(aISO, bISO) {
  const a = new Date(aISO);
  const b = new Date(bISO);
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

function toISODateInput(iso) {
  const d = new Date(iso);
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function loadJSON(key, fallback) {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw);
    return parsed ?? fallback;
  } catch {
    return fallback;
  }
}



function saveJSON(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // ignore
  }
}

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

// One-decimal (0.1) display across the app
function round1(n) {
  const x = Number(n);
  if (!Number.isFinite(x)) return 0;
  return Math.round(x * 10) / 10;
}

function fmt1(n) {
  const x = Number(n);
  if (!Number.isFinite(x)) return "0.0";
  return (Math.round(x * 10) / 10).toFixed(1);
}

function clamp(v, min, max) {
  const n = Number(v);
  if (!Number.isFinite(n)) return min;
  return Math.min(max, Math.max(min, n));
}

// -------------------------
// Seed data
// -------------------------
const EX_TYPES = ["Strength", "Resistance", "Cardio", "Balance"];
const MEALS = ["Breakfast", "Lunch", "Dinner", "Snack"];

const DEFAULT_EXERCISES = [
  { id: "ex_bench", name: "Bench Press", type: "Strength" },
  { id: "ex_squat", name: "Back Squat", type: "Strength" },
  { id: "ex_dead", name: "Deadlift", type: "Strength" },
  { id: "ex_row", name: "Seated Cable Row", type: "Resistance" },
  { id: "ex_lat", name: "Lat Pulldown", type: "Resistance" },
  { id: "ex_ohp", name: "Overhead Press", type: "Strength" },
  { id: "ex_legpress", name: "Leg Press", type: "Resistance" },
  { id: "ex_curl", name: "Biceps Curl", type: "Resistance" },
  { id: "ex_triceps", name: "Triceps Pushdown", type: "Resistance" },
  { id: "ex_plank", name: "Plank", type: "Balance" },
  { id: "ex_singleleg", name: "Single-leg Balance", type: "Balance" },
  { id: "ex_walk", name: "Walking", type: "Cardio" },
  { id: "ex_cycle", name: "Cycling", type: "Cardio" },
  { id: "ex_run", name: "Running", type: "Cardio" },
  { id: "ex_rower", name: "Rowing (Erg)", type: "Cardio" },
];

function emptyMeals() {
  return MEALS.reduce((acc, m) => {
    acc[m] = { items: [] };
    return acc;
  }, {});
}

/**
 * Food item model (v2+):
 * - qty: number of servings
 * - calories/protein/carbs/fat represent PER-SERVING values
 */
function normalizeFoodItem(it) {
  const qty = it?.qty === undefined || it?.qty === null || it?.qty === "" ? 1 : clamp(it.qty, 0, 100);
  return {
    ...it,
    qty,
    calories: it?.calories ?? "",
    protein: it?.protein ?? "",
    carbs: it?.carbs ?? "",
    fat: it?.fat ?? "",
  };
}

function calcMealTotals(meal) {
  const items = (meal?.items || []).map(normalizeFoodItem);
  const totals = items.reduce(
    (t, it) => {
      const q = clamp(it.qty, 0, 100);
      t.calories += num(it.calories) * q;
      t.protein += num(it.protein) * q;
      t.carbs += num(it.carbs) * q;
      t.fat += num(it.fat) * q;
      return t;
    },
    { calories: 0, protein: 0, carbs: 0, fat: 0 }
  );

  return {
    calories: round1(totals.calories),
    protein: round1(totals.protein),
    carbs: round1(totals.carbs),
    fat: round1(totals.fat),
  };
}

function calcDayTotals(day) {
  const meals = day?.meals || emptyMeals();
  const totals = MEALS.reduce(
    (t, m) => {
      const mt = calcMealTotals(meals[m]);
      t.calories += num(mt.calories);
      t.protein += num(mt.protein);
      t.carbs += num(mt.carbs);
      t.fat += num(mt.fat);
      return t;
    },
    { calories: 0, protein: 0, carbs: 0, fat: 0 }
  );

  return {
    calories: round1(totals.calories),
    protein: round1(totals.protein),
    carbs: round1(totals.carbs),
    fat: round1(totals.fat),
  };
}

// -------------------------
// FoodData Central (USDA) helpers
// -------------------------
function extractMacrosFromFDC(food) {
  const list = Array.isArray(food?.foodNutrients) ? food.foodNutrients : [];
  const find = (needle) =>
    list.find((n) =>
      String(n?.nutrientName || "")
        .toLowerCase()
        .includes(needle)
    );

  const caloriesN = find("energy") || list.find((n) => String(n?.nutrientNumber || "") === "208");
  const proteinN = find("protein") || list.find((n) => String(n?.nutrientNumber || "") === "203");
  const carbsN = find("carbohydrate") || list.find((n) => String(n?.nutrientNumber || "") === "205");
  const fatN = find("total lipid") || find("fat") || list.find((n) => String(n?.nutrientNumber || "") === "204");

  const calories = caloriesN?.value ?? caloriesN?.amount ?? "";
  const protein = proteinN?.value ?? proteinN?.amount ?? "";
  const carbs = carbsN?.value ?? carbsN?.amount ?? "";
  const fat = fatN?.value ?? fatN?.amount ?? "";

  return {
    calories: calories === "" ? "" : String(calories),
    protein: protein === "" ? "" : String(protein),
    carbs: carbs === "" ? "" : String(carbs),
    fat: fat === "" ? "" : String(fat),
  };
}

async function fdcSearch({ query, pageSize = 12 }) {
  const url = new URL("/api/fdc/search", window.location.origin);
  url.searchParams.set("query", query);
  url.searchParams.set("pageSize", String(pageSize));

  const res = await fetch(url.toString(), { method: "GET" });
  if (!res.ok) {
    const payload = await res.json().catch(() => ({}));
    throw new Error(payload?.error || `Food search failed (${res.status}).`);
  }
  return res.json();
}

// -------------------------
// Main App
// -------------------------
export default function FitnessTrackerApp() {
  const [tab, setTab] = useState("workouts"); // workouts | nutrition | library

  // Persisted state
  const [exercises, setExercises] = useState(() => loadJSON("ft_exercises_v3", DEFAULT_EXERCISES));
  const [workouts, setWorkouts] = useState(() => loadJSON("ft_workouts_v3", []));
  const [nutritionDays, setNutritionDays] = useState(() => loadJSON("ft_nutrition_v3", []));

  // Daily macro goals (persisted)
  const [macroGoals, setMacroGoals] = useState(() =>
    loadJSON("ft_macro_goals_v1", { calories: "", protein: "", carbs: "", fat: "" })
  );
  useEffect(() => saveJSON("ft_macro_goals_v1", macroGoals), [macroGoals]);

  // Macro timeline controls (persisted)
  const [timelineRange, setTimelineRange] = useState(() => loadJSON("ft_timeline_range_v1", 30));
  const [timelineMode, setTimelineMode] = useState(() => loadJSON("ft_timeline_mode_v1", "macros"));
  const [timelineShowWeight, setTimelineShowWeight] = useState(() => loadJSON("ft_timeline_show_weight_v1", false));
  useEffect(() => saveJSON("ft_timeline_range_v1", timelineRange), [timelineRange]);
  useEffect(() => saveJSON("ft_timeline_mode_v1", timelineMode), [timelineMode]);
  useEffect(() => saveJSON("ft_timeline_show_weight_v1", timelineShowWeight), [timelineShowWeight]);

  // Migration from earlier keys (best-effort)
  useEffect(() => {
    if (typeof window === "undefined") return;
    const prevEx = loadJSON("ft_exercises_v2", null) || loadJSON("ft_exercises_v1", null);
    if (prevEx && Array.isArray(prevEx) && !localStorage.getItem("ft_exercises_v3")) setExercises(prevEx);

    const prevW = loadJSON("ft_workouts_v2", null) || loadJSON("ft_workouts_v1", null);
    if (prevW && Array.isArray(prevW) && !localStorage.getItem("ft_workouts_v3")) setWorkouts(prevW);

    // v2 nutrition was meal-based already; v1 had totals
    const v2n = loadJSON("ft_nutrition_v2", null);
    if (v2n && Array.isArray(v2n) && !localStorage.getItem("ft_nutrition_v3")) setNutritionDays(v2n);

    const v1n = loadJSON("ft_nutrition_v1", null);
    if (v1n && Array.isArray(v1n) && !localStorage.getItem("ft_nutrition_v3") && !v2n) {
      const converted = v1n.map((n) => ({
        id: n.id || uid(),
        date: n.date,
        meals: emptyMeals(),
        notes: n.notes || "",
        legacyTotals: {
          calories: n.calories || "",
          protein: n.protein || "",
          carbs: n.carbs || "",
          fat: n.fat || "",
        },
      }));
      setNutritionDays(converted);
    }
  }, []);

  useEffect(() => saveJSON("ft_exercises_v3", exercises), [exercises]);
  useEffect(() => saveJSON("ft_workouts_v3", workouts), [workouts]);
  useEffect(() => saveJSON("ft_nutrition_v3", nutritionDays), [nutritionDays]);

  // Workout builder state
  const [activeWorkout, setActiveWorkout] = useState(null);

  const todayISODate = useMemo(() => {
    const d = new Date();
    const pad = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }, []);

  const [workoutDate, setWorkoutDate] = useState(todayISODate);
  const [workoutTime, setWorkoutTime] = useState(() => {
    const d = new Date();
    const pad = (n) => String(n).padStart(2, "0");
    return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  });

  // Unified exercise search + free-text
  const [workoutSearch, setWorkoutSearch] = useState("");
  const [workoutTypeFilter, setWorkoutTypeFilter] = useState("All");
  const [workoutAddType, setWorkoutAddType] = useState("Resistance");

  // Library tab search state
  const [librarySearch, setLibrarySearch] = useState("");
  const [libraryTypeFilter, setLibraryTypeFilter] = useState("All");

  const filteredWorkoutExercises = useMemo(() => {
    const q = workoutSearch.trim().toLowerCase();
    return exercises
      .filter((e) => (workoutTypeFilter === "All" ? true : e.type === workoutTypeFilter))
      .filter((e) => (q ? e.name.toLowerCase().includes(q) : true))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [exercises, workoutSearch, workoutTypeFilter]);

  const filteredLibraryExercises = useMemo(() => {
    const q = librarySearch.trim().toLowerCase();
    return exercises
      .filter((e) => (libraryTypeFilter === "All" ? true : e.type === libraryTypeFilter))
      .filter((e) => (q ? e.name.toLowerCase().includes(q) : true))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [exercises, librarySearch, libraryTypeFilter]);

  // Nutrition day selection
  const [nutriDate, setNutriDate] = useState(todayISODate);

  // -------------------------
  // Workout actions
  // -------------------------
  function startWorkout() {
    const ts = new Date(`${workoutDate}T${workoutTime}:00`).toISOString();
    setActiveWorkout({ id: uid(), createdAt: ts, entries: [], notes: "" });
    setTab("workouts");
  }

  function addEntryFromExercise(exercise) {
    if (!activeWorkout) return;
    const isCardio = exercise.type === "Cardio";
    const entry = {
      id: uid(),
      exerciseId: exercise.id,
      exerciseName: exercise.name,
      exerciseType: exercise.type,
      mode: isCardio ? "cardio" : "resistance",
      sets: isCardio ? [] : [{ id: uid(), weight: "", reps: "" }],
      durationMin: isCardio ? "" : "",
      isFreeText: false,
    };
    setActiveWorkout((w) => ({ ...w, entries: [...w.entries, entry] }));
  }

  function addFreeTextEntry() {
    // Unified: use the current workoutSearch value as free-text
    if (!activeWorkout) return;
    const name = workoutSearch.trim();
    if (!name) return;
    const type = workoutAddType;
    const isCardio = type === "Cardio";
    const entry = {
      id: uid(),
      exerciseId: null,
      exerciseName: name,
      exerciseType: type,
      mode: isCardio ? "cardio" : "resistance",
      sets: isCardio ? [] : [{ id: uid(), weight: "", reps: "" }],
      durationMin: isCardio ? "" : "",
      isFreeText: true,
    };
    setActiveWorkout((w) => ({ ...w, entries: [...w.entries, entry] }));
    setWorkoutSearch("");
  }

  function saveFreeTextToLibrary(entry) {
    const name = (entry?.exerciseName || "").trim();
    const type = entry?.exerciseType || "Resistance";
    if (!name) return;
    const exists = exercises.some((e) => e.name.toLowerCase() === name.toLowerCase());
    if (exists) return;
    setExercises((xs) => [...xs, { id: uid(), name, type }]);
  }

  function updateEntry(entryId, patch) {
    setActiveWorkout((w) => {
      if (!w) return w;
      return { ...w, entries: w.entries.map((e) => (e.id === entryId ? { ...e, ...patch } : e)) };
    });
  }

  function removeEntry(entryId) {
    setActiveWorkout((w) => {
      if (!w) return w;
      return { ...w, entries: w.entries.filter((e) => e.id !== entryId) };
    });
  }

  function addSet(entryId) {
    setActiveWorkout((w) => {
      if (!w) return w;
      return {
        ...w,
        entries: w.entries.map((e) =>
          e.id !== entryId ? e : { ...e, sets: [...(e.sets || []), { id: uid(), weight: "", reps: "" }] }
        ),
      };
    });
  }

  function updateSet(entryId, setId, patch) {
    setActiveWorkout((w) => {
      if (!w) return w;
      return {
        ...w,
        entries: w.entries.map((e) => {
          if (e.id !== entryId) return e;
          return { ...e, sets: (e.sets || []).map((s) => (s.id === setId ? { ...s, ...patch } : s)) };
        }),
      };
    });
  }

  function removeSet(entryId, setId) {
    setActiveWorkout((w) => {
      if (!w) return w;
      return {
        ...w,
        entries: w.entries.map((e) =>
          e.id !== entryId ? e : { ...e, sets: (e.sets || []).filter((s) => s.id !== setId) }
        ),
      };
    });
  }

  function saveWorkout() {
    if (!activeWorkout) return;
    const sanitized = {
      ...activeWorkout,
      entries: (activeWorkout.entries || []).map((e) => {
        if (e.mode === "cardio") {
          return { ...e, durationMin: String(e.durationMin ?? "").trim(), sets: [] };
        }
        return {
          ...e,
          durationMin: "",
          sets: (e.sets || []).map((s) => ({
            ...s,
            weight: String(s.weight ?? "").trim(),
            reps: String(s.reps ?? "").trim(),
          })),
        };
      }),
    };

    setWorkouts((ws) => [sanitized, ...ws].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)));
    setActiveWorkout(null);
  }

  function deleteWorkout(workoutId) {
    setWorkouts((ws) => ws.filter((w) => w.id !== workoutId));
  }

  function copyMostRecentWorkoutIntoActive() {
    if (!activeWorkout) return;
    const mostRecent = workouts?.[0];
    if (!mostRecent) return;
    const copiedEntries = (mostRecent.entries || []).map((e) => ({
      ...e,
      id: uid(),
      sets: (e.sets || []).map((s) => ({ ...s, id: uid() })),
      durationMin: e.durationMin || "",
    }));
    setActiveWorkout((w) => ({ ...w, entries: copiedEntries }));
  }

  // -------------------------
  // Nutrition actions
  // -------------------------
  const selectedDay = useMemo(() => {
    const dayISO = isoDateFromInput(nutriDate);
    const existing = nutritionDays.find((d) => sameDayISO(d.date, dayISO));
    return existing || { id: null, date: dayISO, meals: emptyMeals(), notes: "", weight: "" };
  }, [nutritionDays, nutriDate]);

  const selectedDayTotals = useMemo(() => calcDayTotals(selectedDay), [selectedDay]);

  function upsertDay(patch) {
    const dayISO = isoDateFromInput(nutriDate);
    setNutritionDays((days) => {
      const idx = days.findIndex((d) => sameDayISO(d.date, dayISO));
      if (idx === -1) {
        return [{ id: uid(), date: dayISO, meals: emptyMeals(), notes: "", weight: "", ...patch }, ...days].sort(
          (a, b) => (a.date < b.date ? 1 : -1)
        );
      }
      const copy = [...days];
      copy[idx] = { ...copy[idx], ...patch };
      return copy;
    });
  }

  function deleteDay(dateISO) {
    setNutritionDays((days) => days.filter((d) => d.date !== dateISO));
  }

  function addFoodToMeal(mealName, item) {
    const meals = { ...(selectedDay.meals || emptyMeals()) };
    const prev = meals[mealName]?.items || [];
    meals[mealName] = { items: [{ ...normalizeFoodItem({ ...item, id: uid() }) }, ...prev] };
    upsertDay({ meals });
  }

  function updateFoodItem(mealName, itemId, patch) {
    const meals = { ...(selectedDay.meals || emptyMeals()) };
    meals[mealName] = {
      items: (meals[mealName]?.items || []).map((it) =>
        it.id === itemId ? normalizeFoodItem({ ...it, ...patch }) : it
      ),
    };
    upsertDay({ meals });
  }

  function removeFoodItem(mealName, itemId) {
    const meals = { ...(selectedDay.meals || emptyMeals()) };
    meals[mealName] = { items: (meals[mealName]?.items || []).filter((it) => it.id !== itemId) };
    upsertDay({ meals });
  }

  function copyMealsFromPreviousDay() {
    const dayISO = isoDateFromInput(nutriDate);
    const dayDate = new Date(dayISO);
    const prev = nutritionDays
      .filter((d) => new Date(d.date) < dayDate)
      .sort((a, b) => (a.date < b.date ? 1 : -1))[0];
    if (!prev) return;

    const mealsCopy = JSON.parse(JSON.stringify(prev.meals || emptyMeals()));
    for (const m of MEALS) {
      mealsCopy[m].items = (mealsCopy[m].items || []).map((it) => normalizeFoodItem({ ...it, id: uid() }));
    }
    upsertDay({ meals: mealsCopy });
  }

  function copyMealFromPreviousDay(mealName, mode = "replace") {
    const dayISO = isoDateFromInput(nutriDate);
    const dayDate = new Date(dayISO);
    const prev = nutritionDays
      .filter((d) => new Date(d.date) < dayDate)
      .sort((a, b) => (a.date < b.date ? 1 : -1))[0];
    if (!prev) return;

    const prevMealItems = (prev.meals?.[mealName]?.items || []).map((it) => normalizeFoodItem({ ...it, id: uid() }));

    const meals = { ...(selectedDay.meals || emptyMeals()) };
    const current = meals[mealName]?.items || [];

    meals[mealName] = {
      items: mode === "append" ? [...prevMealItems, ...current] : prevMealItems,
    };

    upsertDay({ meals });
  }

  // -------------------------
  // Exercise library actions
  // -------------------------
  const [newExName, setNewExName] = useState("");
  const [newExType, setNewExType] = useState("Strength");

  function addCustomExercise() {
    const name = newExName.trim();
    if (!name) return;
    const exists = exercises.some((e) => e.name.toLowerCase() === name.toLowerCase());
    if (exists) return;
    setExercises((xs) => [...xs, { id: uid(), name, type: newExType }]);
    setNewExName("");
  }

  function deleteExercise(exId) {
    setExercises((xs) => xs.filter((e) => e.id !== exId));
  }

  function exportData() {
    const blob = new Blob(
      [JSON.stringify({ exercises, workouts, nutritionDays, exportedAt: new Date().toISOString() }, null, 2)],
      { type: "application/json" }
    );
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `fitness-tracker-export-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function importData(file) {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(String(reader.result || "{}"));
        if (parsed.exercises && Array.isArray(parsed.exercises)) setExercises(parsed.exercises);
        if (parsed.workouts && Array.isArray(parsed.workouts)) setWorkouts(parsed.workouts);
        const nd = parsed.nutritionDays || parsed.nutrition;
        if (nd && Array.isArray(nd)) setNutritionDays(nd);
      } catch {
        // ignore
      }
    };
    reader.readAsText(file);
  }

  const importRef = useRef(null);

  // -------------------------
  // UI
  // -------------------------
  return (
    <div className="min-h-screen bg-gray-50 text-gray-900">
      <div className="mx-auto max-w-6xl p-4 sm:p-6">
        <header className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-2xl font-semibold">Fitness Tracker</h1>
            <p className="text-sm text-gray-600">Track workouts and meal-based nutrition. Saves locally in your browser.</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              className="rounded-xl bg-white px-3 py-2 text-sm shadow-sm ring-1 ring-gray-200 hover:bg-gray-100"
              onClick={exportData}
            >
              Export
            </button>
            <button
              className="rounded-xl bg-white px-3 py-2 text-sm shadow-sm ring-1 ring-gray-200 hover:bg-gray-100"
              onClick={() => importRef.current?.click()}
            >
              Import
            </button>
            <input
              ref={importRef}
              type="file"
              accept="application/json"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) importData(f);
                e.target.value = "";
              }}
            />
          </div>
        </header>

        <nav className="mt-6 flex flex-wrap gap-2">
          <TabButton active={tab === "workouts"} onClick={() => setTab("workouts")}>Workouts</TabButton>
          <TabButton active={tab === "nutrition"} onClick={() => setTab("nutrition")}>Nutrition</TabButton>
          <TabButton active={tab === "library"} onClick={() => setTab("library")}>Exercise Library</TabButton>
        </nav>

        {tab === "workouts" && (
          <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-12">
            <section className="lg:col-span-5">
              <Card title="Start a workout">
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <Field label="Date">
                    <input
                      type="date"
                      value={workoutDate}
                      onChange={(e) => setWorkoutDate(e.target.value)}
                      className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2"
                    />
                  </Field>
                  <Field label="Time">
                    <input
                      type="time"
                      value={workoutTime}
                      onChange={(e) => setWorkoutTime(e.target.value)}
                      className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2"
                    />
                  </Field>
                </div>

                <div className="mt-4 flex flex-wrap items-center gap-2">
                  {!activeWorkout ? (
                    <button
                      onClick={startWorkout}
                      className="rounded-xl bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-black"
                    >
                      Start Workout
                    </button>
                  ) : (
                    <>
                      <button
                        onClick={saveWorkout}
                        className="rounded-xl bg-green-600 px-4 py-2 text-sm font-medium text-white hover:bg-green-700"
                      >
                        Save Workout
                      </button>
                      <button
                        onClick={() => setActiveWorkout(null)}
                        className="rounded-xl bg-white px-4 py-2 text-sm font-medium text-gray-900 shadow-sm ring-1 ring-gray-200 hover:bg-gray-100"
                      >
                        Discard
                      </button>
                      <button
                        onClick={copyMostRecentWorkoutIntoActive}
                        className="rounded-xl bg-white px-4 py-2 text-sm font-medium text-gray-900 shadow-sm ring-1 ring-gray-200 hover:bg-gray-100"
                        title="Copies the most recent saved workout into the current workout"
                      >
                        Copy last workout
                      </button>
                    </>
                  )}
                </div>

                {activeWorkout && (
                  <div className="mt-4">
                    <Field label="Workout Notes">
                      <textarea
                        value={activeWorkout.notes}
                        onChange={(e) => setActiveWorkout((w) => ({ ...w, notes: e.target.value }))}
                        rows={3}
                        className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2"
                        placeholder="Optional notes…"
                      />
                    </Field>
                    <div className="mt-2 text-xs text-gray-500">
                      Timestamp: <span className="font-medium">{fmtDateTime(activeWorkout.createdAt)}</span>
                    </div>
                  </div>
                )}
              </Card>

              <Card title="Add exercises" subtitle={activeWorkout ? "Search the library — if it doesn’t appear, add it as free-text." : "Start a workout to add entries."}>
                {/* Stacked layout for readability */}
                <div className="space-y-3">
                  <Field label="Search (or type free-text)">
                    <input
                      value={workoutSearch}
                      onChange={(e) => setWorkoutSearch(e.target.value)}
                      className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2"
                      placeholder="e.g., squat, cycling, cable fly…"
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          const q = workoutSearch.trim();
                          const hasMatch = filteredWorkoutExercises.length > 0;
                          if (q && !hasMatch) addFreeTextEntry();
                        }
                      }}
                    />
                  </Field>

                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <Field label="Filter type">
                      <select
                        value={workoutTypeFilter}
                        onChange={(e) => setWorkoutTypeFilter(e.target.value)}
                        className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2"
                      >
                        <option value="All">All</option>
                        {EX_TYPES.map((t) => (
                          <option key={t} value={t}>
                            {t}
                          </option>
                        ))}
                      </select>
                    </Field>

                    <Field label="If no match, add as">
                      <select
                        value={workoutAddType}
                        onChange={(e) => setWorkoutAddType(e.target.value)}
                        className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2"
                      >
                        {EX_TYPES.map((t) => (
                          <option key={t} value={t}>
                            {t}
                          </option>
                        ))}
                      </select>
                    </Field>
                  </div>

                  <div className="text-xs text-gray-500">{filteredWorkoutExercises.length} matches</div>
                </div>

                <div className="mt-4 max-h-[260px] overflow-auto rounded-xl border border-gray-100 bg-white">
                  {filteredWorkoutExercises.length === 0 ? (
                    <div className="p-4 text-sm text-gray-600">No exercises match your search.
                      {workoutSearch.trim() ? (
                        <div className="mt-3 flex flex-wrap items-center gap-2">
                          <button
                            disabled={!activeWorkout}
                            onClick={addFreeTextEntry}
                            className={
                              "rounded-xl px-3 py-2 text-sm font-medium " +
                              (activeWorkout ? "bg-gray-900 text-white hover:bg-black" : "bg-gray-100 text-gray-400 cursor-not-allowed")
                            }
                          >
                            Add “{workoutSearch.trim()}” as free-text ({workoutAddType})
                          </button>
                          <div className="text-xs text-gray-500">Tip: after adding, use “Save to library” in the entry card.</div>
                        </div>
                      ) : null}</div>
                  ) : (
                    <ul className="divide-y divide-gray-100">
                      {filteredWorkoutExercises.map((ex) => (
                        <li key={ex.id} className="flex items-center justify-between gap-3 p-3">
                          <div>
                            <div className="text-sm font-medium">{ex.name}</div>
                            <div className="text-xs text-gray-500">{ex.type}</div>
                          </div>
                          <button
                            disabled={!activeWorkout}
                            onClick={() => addEntryFromExercise(ex)}
                            className={
                              "rounded-xl px-3 py-2 text-sm font-medium " +
                              (activeWorkout ? "bg-gray-900 text-white hover:bg-black" : "bg-gray-100 text-gray-400 cursor-not-allowed")
                            }
                          >
                            Add
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>

                <div className="mt-3 text-xs text-gray-600">Type anything in the search box above — if it doesn’t appear, add it as free-text.</div>
              </Card>
            </section>

            <section className="lg:col-span-7">
              <Card
                title={activeWorkout ? "Active workout" : "Workout history"}
                subtitle={activeWorkout ? "Track resistance + cardio in the same workout." : "Your saved workouts (most recent first)."}
              >
                {activeWorkout ? (
                  <div className="space-y-4">
                    {activeWorkout.entries.length === 0 ? (
                      <div className="rounded-xl border border-dashed border-gray-200 p-6 text-sm text-gray-600">Add exercises to start tracking.</div>
                    ) : (
                      activeWorkout.entries.map((entry) => (
                        <EntryEditor
                          key={entry.id}
                          entry={entry}
                          onRemove={() => removeEntry(entry.id)}
                          onModeChange={(mode) => updateEntry(entry.id, { mode })}
                          onDurationChange={(durationMin) => updateEntry(entry.id, { durationMin })}
                          onAddSet={() => addSet(entry.id)}
                          onUpdateSet={(setId, patch) => updateSet(entry.id, setId, patch)}
                          onRemoveSet={(setId) => removeSet(entry.id, setId)}
                          onSaveToLibrary={() => saveFreeTextToLibrary(entry)}
                        />
                      ))
                    )}
                  </div>
                ) : (
                  <WorkoutHistory workouts={workouts} onDelete={deleteWorkout} />
                )}
              </Card>
            </section>
          </div>
        )}

        {tab === "nutrition" && (
          <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-12">
            <section className="lg:col-span-5">
              <Card title="Meals + macros">
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <Field label="Date">
                    <input
                      type="date"
                      value={nutriDate}
                      onChange={(e) => setNutriDate(e.target.value)}
                      className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2"
                    />
                  </Field>
                  <Field label="Weight (optional)">
                    <input
                      inputMode="decimal"
                      value={selectedDay.weight ?? ""}
                      onChange={(e) => upsertDay({ weight: e.target.value })}
                      className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2"
                      placeholder="e.g., 220.4"
                    />
                  </Field>
                </div>

                <div className="mt-4 rounded-2xl border border-gray-200 bg-white p-4">
                  <div className="text-sm font-semibold">Daily totals</div>
                  <div className="mt-2 grid grid-cols-2 gap-3 text-sm">
                    <MetricGoal label="Calories" actual={selectedDayTotals.calories} goal={macroGoals.calories} suffix="" />
                    <MetricGoal label="Protein" actual={selectedDayTotals.protein} goal={macroGoals.protein} suffix="g" />
                    <MetricGoal label="Carbs" actual={selectedDayTotals.carbs} goal={macroGoals.carbs} suffix="g" />
                    <MetricGoal label="Fat" actual={selectedDayTotals.fat} goal={macroGoals.fat} suffix="g" />
                  </div>

                  <div className="mt-4">
                    <WeeklyAverages days={nutritionDays} anchorISO={selectedDay.date} />
                  </div>
                </div>

                <div className="mt-4 rounded-2xl border border-gray-200 bg-white p-4">
                  <div className="text-sm font-semibold">Daily macro goals</div>
                  <div className="mt-2 grid grid-cols-2 gap-2">
                    <GoalInput label="Calories" value={macroGoals.calories} onChange={(v) => setMacroGoals((g) => ({ ...g, calories: v }))} />
                    <GoalInput label="Protein (g)" value={macroGoals.protein} onChange={(v) => setMacroGoals((g) => ({ ...g, protein: v }))} />
                    <GoalInput label="Carbs (g)" value={macroGoals.carbs} onChange={(v) => setMacroGoals((g) => ({ ...g, carbs: v }))} />
                    <GoalInput label="Fat (g)" value={macroGoals.fat} onChange={(v) => setMacroGoals((g) => ({ ...g, fat: v }))} />
                  </div>
                </div>

                <div className="mt-4 flex flex-wrap gap-2">
                  <button
                    onClick={copyMealsFromPreviousDay}
                    className="rounded-xl bg-white px-4 py-2 text-sm font-medium text-gray-900 shadow-sm ring-1 ring-gray-200 hover:bg-gray-100"
                  >
                    Copy ALL meals from previous day
                  </button>

                  {selectedDay.id && (
                    <button
                      onClick={() => deleteDay(selectedDay.date)}
                      className="rounded-xl bg-white px-4 py-2 text-sm font-medium text-red-700 shadow-sm ring-1 ring-red-200 hover:bg-red-50"
                    >
                      Delete this day
                    </button>
                  )}
                </div>

                <div className="mt-4">
                  <Field label="Day notes">
                    <textarea
                      value={selectedDay.notes || ""}
                      onChange={(e) => upsertDay({ notes: e.target.value })}
                      rows={4}
                      className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2"
                      placeholder="How you felt, hunger, cravings, etc."
                    />
                  </Field>
                </div>

                

                {selectedDay.legacyTotals ? (
                  <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 p-4">
                    <div className="text-sm font-semibold">Imported totals (legacy)</div>
                    <div className="mt-2 text-xs text-amber-800">This day was imported from an older version that stored only daily totals.</div>
                    <div className="mt-2 grid grid-cols-2 gap-3 text-sm">
                      <Metric label="Calories" value={selectedDay.legacyTotals.calories || "—"} />
                      <Metric label="Protein" value={selectedDay.legacyTotals.protein || "—"} suffix="g" />
                      <Metric label="Carbs" value={selectedDay.legacyTotals.carbs || "—"} suffix="g" />
                      <Metric label="Fat" value={selectedDay.legacyTotals.fat || "—"} suffix="g" />
                    </div>
                  </div>
                ) : null}
              </Card>
            </section>

            <section className="lg:col-span-7">
              <Card title="Log foods by meal" subtitle="Manual entry or USDA database search via secure server proxy. Macros are per-serving with quantity multipliers.">
                <FoodLogger
                  day={selectedDay}
                  onAddFood={addFoodToMeal}
                  onUpdateFood={updateFoodItem}
                  onRemoveFood={removeFoodItem}
                  onCopyMeal={(mealName, mode) => copyMealFromPreviousDay(mealName, mode)}
                />
              </Card>

              <div className="mt-4">
                <Card title="Macro timeline" subtitle="Track trends day-to-day.">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
                    <div className="text-sm text-gray-600">View</div>
                    <div className="flex flex-wrap items-center gap-2">
                      <label className="block">
                        <div className="mb-1 text-[11px] font-medium text-gray-600">Metric</div>
                        <select
                          value={timelineMode}
                          onChange={(e) => setTimelineMode(e.target.value)}
                          className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm"
                        >
                          <option value="macros">Protein/Carbs/Fat</option>
                          <option value="calories">Calories</option>
                        </select>
                      </label>
                      <label className="block">
                        <div className="mb-1 text-[11px] font-medium text-gray-600">Range</div>
                        <select
                          value={timelineRange}
                          onChange={(e) => setTimelineRange(Number(e.target.value))}
                          className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm"
                        >
                          <option value={7}>Last 7 days</option>
                          <option value={14}>Last 14 days</option>
                          <option value={30}>Last 30 days</option>
                          <option value={90}>Last 90 days</option>
                        </select>
                      </label>

                      
                    </div>
                  </div>

                  <div className="mt-3">
                    <MacroTimeline days={nutritionDays} goals={macroGoals} mode={timelineMode} range={timelineRange} />
                  </div>
                </Card>
              </div>

              <div className="mt-4">
                <Card title="Weight + calories" subtitle="Weight trend with daily calories and a 7-day calorie average.">
                  <WeightCaloriesChart days={nutritionDays} range={timelineRange} />
                </Card>
              </div>

              <div className="mt-4">
                <Card title="Nutrition history" subtitle="Most recent days first.">
                  <NutritionHistory
                    days={nutritionDays}
                    onEdit={(iso) => {
                      setNutriDate(toISODateInput(iso));
                      setTab("nutrition");
                    }}
                  />
                </Card>
              </div>
            </section>
          </div>
        )}

        {tab === "library" && (
          <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-12">
            <section className="lg:col-span-5">
              <Card title="Add a custom exercise">
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <Field label="Name">
                    <input
                      value={newExName}
                      onChange={(e) => setNewExName(e.target.value)}
                      className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2"
                      placeholder="e.g., Incline DB Press"
                    />
                  </Field>
                  <Field label="Type">
                    <select
                      value={newExType}
                      onChange={(e) => setNewExType(e.target.value)}
                      className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2"
                    >
                      {EX_TYPES.map((t) => (
                        <option key={t} value={t}>{t}</option>
                      ))}
                    </select>
                  </Field>
                </div>
                <div className="mt-4 flex gap-2">
                  <button
                    onClick={addCustomExercise}
                    className="rounded-xl bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-black"
                  >
                    Add Exercise
                  </button>
                  <button
                    onClick={() => setExercises(DEFAULT_EXERCISES)}
                    className="rounded-xl bg-white px-4 py-2 text-sm font-medium text-gray-900 shadow-sm ring-1 ring-gray-200 hover:bg-gray-100"
                  >
                    Reset to Defaults
                  </button>
                </div>
              </Card>
            </section>

            <section className="lg:col-span-7">
              <Card title="Your exercise library" subtitle="These appear in Workouts → Add exercises.">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="text-sm text-gray-600">{exercises.length} total</div>
                  <div className="flex items-center gap-2">
                    <input
                      value={librarySearch}
                      onChange={(e) => setLibrarySearch(e.target.value)}
                      className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm"
                      placeholder="Search library…"
                    />
                    <select
                      value={libraryTypeFilter}
                      onChange={(e) => setLibraryTypeFilter(e.target.value)}
                      className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm"
                    >
                      <option value="All">All</option>
                      {EX_TYPES.map((t) => (
                        <option key={t} value={t}>{t}</option>
                      ))}
                    </select>
                  </div>
                </div>

                <div className="mt-4 max-h-[520px] overflow-auto rounded-xl border border-gray-100 bg-white">
                  <ul className="divide-y divide-gray-100">
                    {filteredLibraryExercises.map((ex) => (
                      <li key={ex.id} className="flex items-center justify-between gap-3 p-3">
                        <div>
                          <div className="text-sm font-medium">{ex.name}</div>
                          <div className="text-xs text-gray-500">{ex.type}</div>
                        </div>
                        <button
                          onClick={() => deleteExercise(ex.id)}
                          className="rounded-xl bg-white px-3 py-2 text-sm font-medium text-red-700 shadow-sm ring-1 ring-red-200 hover:bg-red-50"
                        >
                          Delete
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              </Card>
            </section>
          </div>
        )}

        <footer className="mt-10 pb-10 text-xs text-gray-500">
          <div className="rounded-2xl border border-gray-200 bg-white p-4">
            <div className="font-medium text-gray-700">How it works</div>
            <ul className="mt-2 list-disc space-y-1 pl-5">
              <li>Workouts are saved with a date/time timestamp and can include both resistance and cardio entries.</li>
              <li>Nutrition is logged by meal, with per-meal and daily macro totals (supports per-item quantity multipliers).</li>
              <li>Data is stored only in your browser (localStorage). Use Export/Import to back up or move devices.</li>
              <li>Food database search uses USDA FoodData Central if you provide an API key.</li>
            </ul>
          </div>
        </footer>
      </div>
    </div>
  );
}

// -------------------------
// Components
// -------------------------
function TabButton({ active, onClick, children }) {
  return (
    <button
      onClick={onClick}
      className={
        "rounded-2xl px-4 py-2 text-sm font-medium shadow-sm ring-1 transition " +
        (active ? "bg-gray-900 text-white ring-gray-900" : "bg-white text-gray-900 ring-gray-200 hover:bg-gray-100")
      }
    >
      {children}
    </button>
  );
}

function Card({ title, subtitle, children }) {
  return (
    <div className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-gray-200">
      <div className="flex flex-col gap-1">
        <div className="text-base font-semibold">{title}</div>
        {subtitle ? <div className="text-sm text-gray-600">{subtitle}</div> : null}
      </div>
      <div className="mt-4">{children}</div>
    </div>
  );
}

function Field({ label, children }) {
  return (
    <label className="block">
      <div className="mb-1 text-xs font-medium text-gray-600">{label}</div>
      {children}
    </label>
  );
}

function Metric({ label, value, suffix = "" }) {
  const display = typeof value === "number" ? fmt1(value) : String(value ?? "—");
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-3">
      <div className="text-xs text-gray-600">{label}</div>
      <div className="mt-1 text-lg font-semibold">
        {display}
        {suffix}
      </div>
    </div>
  );
}

function MetricGoal({ label, actual, goal, suffix = "" }) {
  const a = num(actual);
  const g = num(goal);
  const hasGoal = g > 0;
  const remaining = hasGoal ? round1(g - a) : null;
  const over = hasGoal ? round1(a - g) : null;
  const pct = hasGoal ? clamp((a / g) * 100, 0, 200) : null;

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-3">
      <div className="text-xs text-gray-600">{label}</div>
      <div className="mt-1 text-lg font-semibold">
        {hasGoal ? (
          <>
            {fmt1(a)}
            {suffix} <span className="text-sm font-medium text-gray-500">/ {fmt1(g)}{suffix}</span>
          </>
        ) : (
          <>
            {fmt1(a)}
            {suffix}
          </>
        )}
      </div>
      <div className="mt-1 text-xs text-gray-600">
        {hasGoal ? (
          remaining >= 0 ? (
            <>Left: <span className="font-medium">{fmt1(remaining)}{suffix}</span></>
          ) : (
            <>Over: <span className="font-medium">{fmt1(over)}{suffix}</span></>
          )
        ) : (
          <>Set a goal to see “left”.</>
        )}
      </div>

      {hasGoal ? (
        <div className="mt-2 h-2 w-full rounded-full bg-gray-100">
          <div
            className="h-2 rounded-full bg-gray-900"
            style={{ width: `${pct}%` }}
            title={`${Math.round(pct)}%`}
          />
        </div>
      ) : null}
    </div>
  );
}

function EntryEditor({ entry, onRemove, onModeChange, onDurationChange, onAddSet, onUpdateSet, onRemoveSet, onSaveToLibrary }) {
  const isCardio = entry.mode === "cardio";

  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <div className="text-sm font-semibold">
            {entry.exerciseName}{" "}
            {entry.isFreeText ? (
              <span className="ml-2 rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-700">Free-text</span>
            ) : null}
          </div>
          <div className="mt-0.5 text-xs text-gray-500">{entry.exerciseType}</div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {entry.isFreeText ? (
            <button
              onClick={onSaveToLibrary}
              className="rounded-xl bg-white px-3 py-2 text-sm font-medium text-gray-900 shadow-sm ring-1 ring-gray-200 hover:bg-gray-100"
              title="Save this free-text exercise into your library"
            >
              Save to library
            </button>
          ) : null}
          <select
            value={entry.mode}
            onChange={(e) => onModeChange(e.target.value)}
            className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm"
            title="Entry mode"
          >
            <option value="resistance">Resistance (sets)</option>
            <option value="cardio">Cardio (duration)</option>
          </select>
          <button
            onClick={onRemove}
            className="rounded-xl bg-white px-3 py-2 text-sm font-medium text-red-700 shadow-sm ring-1 ring-red-200 hover:bg-red-50"
          >
            Remove
          </button>
        </div>
      </div>

      {isCardio ? (
        <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Duration (minutes)">
            <input
              inputMode="numeric"
              value={entry.durationMin}
              onChange={(e) => onDurationChange(e.target.value)}
              className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2"
              placeholder="e.g., 30"
            />
          </Field>
          <div className="flex items-end">
            <div className="text-xs text-gray-500">Tip: switch any entry to Cardio mode if you prefer time-based tracking.</div>
          </div>
        </div>
      ) : (
        <div className="mt-4">
          <div className="overflow-auto rounded-xl border border-gray-100">
            <table className="w-full min-w-[520px] border-collapse bg-white">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-600">Set</th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-600">Weight</th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-600">Reps</th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-600"> </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {(entry.sets || []).map((s, idx) => (
                  <tr key={s.id}>
                    <td className="px-3 py-2 text-sm text-gray-700">{idx + 1}</td>
                    <td className="px-3 py-2">
                      <input
                        value={s.weight}
                        onChange={(e) => onUpdateSet(s.id, { weight: e.target.value })}
                        className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm"
                        placeholder="e.g., 135"
                      />
                    </td>
                    <td className="px-3 py-2">
                      <input
                        value={s.reps}
                        onChange={(e) => onUpdateSet(s.id, { reps: e.target.value })}
                        className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm"
                        placeholder="e.g., 8"
                      />
                    </td>
                    <td className="px-3 py-2 text-right">
                      <button
                        onClick={() => onRemoveSet(s.id)}
                        className="rounded-xl bg-white px-3 py-2 text-sm font-medium text-red-700 shadow-sm ring-1 ring-red-200 hover:bg-red-50"
                      >
                        Delete
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button onClick={onAddSet} className="rounded-xl bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-black">
              Add Set
            </button>
            <div className="text-xs text-gray-500">Enter any units you want (lbs/kg). You can also use bodyweight like “BW”.</div>
          </div>
        </div>
      )}
    </div>
  );
}

function WorkoutHistory({ workouts, onDelete }) {
  if (!workouts || workouts.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-gray-200 p-6 text-sm text-gray-600">No saved workouts yet.</div>
    );
  }

  return (
    <div className="space-y-3">
      {workouts.map((w) => (
        <div key={w.id} className="rounded-2xl border border-gray-200 bg-white p-4">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <div className="text-sm font-semibold">{fmtDateTime(w.createdAt)}</div>
              <div className="mt-1 text-xs text-gray-600">
                {w.entries.length} entr{w.entries.length === 1 ? "y" : "ies"}
                {w.notes ? " · Notes included" : ""}
              </div>
            </div>
            <button
              onClick={() => onDelete(w.id)}
              className="rounded-xl bg-white px-3 py-2 text-sm font-medium text-red-700 shadow-sm ring-1 ring-red-200 hover:bg-red-50"
            >
              Delete
            </button>
          </div>

          {w.notes ? <div className="mt-2 whitespace-pre-wrap text-sm text-gray-700">{w.notes}</div> : null}

          <div className="mt-3 space-y-2">
            {w.entries.map((e) => (
              <div key={e.id} className="rounded-xl bg-gray-50 p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <div className="text-sm font-medium">{e.exerciseName}</div>
                    <div className="text-xs text-gray-500">{e.exerciseType} · {e.mode === "cardio" ? "Cardio" : "Resistance"}</div>
                  </div>
                  {e.mode === "cardio" ? (
                    <div className="text-sm text-gray-700">Duration: <span className="font-semibold">{e.durationMin || "—"}</span> min</div>
                  ) : (
                    <div className="text-xs text-gray-600">{(e.sets || []).length} sets</div>
                  )}
                </div>

                {e.mode !== "cardio" ? (
                  <div className="mt-2 overflow-auto rounded-lg border border-gray-200 bg-white">
                    <table className="w-full min-w-[420px] border-collapse">
                      <thead className="bg-white">
                        <tr>
                          <th className="px-3 py-2 text-left text-xs font-medium text-gray-600">Set</th>
                          <th className="px-3 py-2 text-left text-xs font-medium text-gray-600">Weight</th>
                          <th className="px-3 py-2 text-left text-xs font-medium text-gray-600">Reps</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100">
                        {(e.sets || []).map((s, idx) => (
                          <tr key={s.id}>
                            <td className="px-3 py-2 text-sm text-gray-700">{idx + 1}</td>
                            <td className="px-3 py-2 text-sm text-gray-700">{s.weight || "—"}</td>
                            <td className="px-3 py-2 text-sm text-gray-700">{s.reps || "—"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function FoodLogger({ day, onAddFood, onUpdateFood, onRemoveFood, onCopyMeal }) {
  const meals = useMemo(() => day?.meals || emptyMeals(), [day]);

  const mealTotals = useMemo(() => {
    return MEALS.reduce((acc, mealName) => {
      acc[mealName] = calcMealTotals(meals[mealName]);
      return acc;
    }, {});
  }, [meals]);

  return (
    <div className="space-y-4">
      {MEALS.map((mealName) => (
        <MealSection
          key={mealName}
          mealName={mealName}
          meal={meals[mealName]}
          totals={mealTotals[mealName]}
          onAdd={(item) => onAddFood(mealName, item)}
          onUpdate={(itemId, patch) => onUpdateFood(mealName, itemId, patch)}
          onRemove={(itemId) => onRemoveFood(mealName, itemId)}
          onCopy={(mode) => onCopyMeal?.(mealName, mode)}
        />
      ))}
    </div>
  );
}

function MealSection({ mealName, meal, totals, onAdd, onUpdate, onRemove, onCopy }) {
  const [openAdd, setOpenAdd] = useState(false);
  const items = (meal?.items || []).map(normalizeFoodItem);

  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-base font-semibold">{mealName}</div>
          <div className="mt-1 text-xs text-gray-600">
            Totals — {fmt1(totals?.calories || 0)} cal · P {fmt1(totals?.protein || 0)}g · C {fmt1(totals?.carbs || 0)}g · F {fmt1(totals?.fat || 0)}g
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={() => setOpenAdd((v) => !v)}
            className="rounded-xl bg-gray-900 px-3 py-2 text-sm font-medium text-white hover:bg-black"
          >
            {openAdd ? "Close" : "Add items"}
          </button>
          <button
            onClick={() => onCopy?.("replace")}
            className="rounded-xl bg-white px-3 py-2 text-sm font-medium text-gray-900 shadow-sm ring-1 ring-gray-200 hover:bg-gray-100"
            title={`Replace ${mealName} with previous day's ${mealName}`}
          >
            Copy prev
          </button>
          <button
            onClick={() => onCopy?.("append")}
            className="rounded-xl bg-white px-3 py-2 text-sm font-medium text-gray-900 shadow-sm ring-1 ring-gray-200 hover:bg-gray-100"
            title={`Append previous day's ${mealName} to today's ${mealName}`}
          >
            Append prev
          </button>
        </div>
      </div>

      {openAdd ? (
        <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
          <div>
            <div className="text-sm font-semibold">Add food (manual)</div>
            <ManualFoodForm onAdd={onAdd} />
          </div>
          <div>
            <div className="text-sm font-semibold">Search foods (USDA FoodData Central)</div>
            <FoodSearch onPick={onAdd} />
          </div>
        </div>
      ) : null}

      <div className="mt-4 overflow-auto rounded-xl border border-gray-100">
        <table className="w-full min-w-[860px] border-collapse bg-white">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-3 py-2 text-left text-xs font-medium text-gray-600">Item</th>
              <th className="px-3 py-2 text-left text-xs font-medium text-gray-600">Serving</th>
              <th className="px-3 py-2 text-left text-xs font-medium text-gray-600">Qty</th>
              <th className="px-3 py-2 text-left text-xs font-medium text-gray-600">Cal</th>
              <th className="px-3 py-2 text-left text-xs font-medium text-gray-600">P</th>
              <th className="px-3 py-2 text-left text-xs font-medium text-gray-600">C</th>
              <th className="px-3 py-2 text-left text-xs font-medium text-gray-600">F</th>
              <th className="px-3 py-2 text-left text-xs font-medium text-gray-600">Total Cal</th>
              <th className="px-3 py-2 text-left text-xs font-medium text-gray-600">Total P</th>
              <th className="px-3 py-2 text-left text-xs font-medium text-gray-600">Total C</th>
              <th className="px-3 py-2 text-left text-xs font-medium text-gray-600">Total F</th>
              <th className="px-3 py-2 text-right text-xs font-medium text-gray-600"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {items.length === 0 ? (
              <tr>
                <td colSpan={12} className="px-3 py-6 text-sm text-gray-600">No items yet for {mealName}. Click “Add items”.</td>
              </tr>
            ) : (
              items.map((it) => (
                <MealItemRow
                  key={it.id}
                  item={it}
                  onChange={(patch) => onUpdate(it.id, patch)}
                  onRemove={() => onRemove(it.id)}
                />
              ))
            )}
          </tbody>
        </table>
      </div>

      <div className="mt-2 text-xs text-gray-600">All values are shown to one decimal (0.1). Edit per-serving macros and Qty as needed.</div>
    </div>
  );
}

function MealItemRow({ item, onChange, onRemove }) {
  const it = normalizeFoodItem(item);
  const q = clamp(it.qty, 0, 100);
  const totalCalories = round1(num(it.calories) * q);
  const totalProtein = round1(num(it.protein) * q);
  const totalCarbs = round1(num(it.carbs) * q);
  const totalFat = round1(num(it.fat) * q);

  return (
    <tr>
      <td className="px-3 py-2 text-sm font-medium text-gray-800">{it.name}</td>
      <td className="px-3 py-2 text-xs text-gray-600">{it.brand ? `${it.brand} · ` : ""}{it.serving || ""}</td>
      <td className="px-3 py-2">
        <input
          inputMode="decimal"
          value={it.qty ?? ""}
          onChange={(e) => onChange({ qty: e.target.value })}
          className="w-20 rounded-xl border border-gray-200 bg-white px-2 py-1 text-sm"
        />
      </td>
      <td className="px-3 py-2">
        <input
          inputMode="decimal"
          value={it.calories ?? ""}
          onChange={(e) => onChange({ calories: e.target.value })}
          className="w-20 rounded-xl border border-gray-200 bg-white px-2 py-1 text-sm"
        />
      </td>
      <td className="px-3 py-2">
        <input
          inputMode="decimal"
          value={it.protein ?? ""}
          onChange={(e) => onChange({ protein: e.target.value })}
          className="w-20 rounded-xl border border-gray-200 bg-white px-2 py-1 text-sm"
        />
      </td>
      <td className="px-3 py-2">
        <input
          inputMode="decimal"
          value={it.carbs ?? ""}
          onChange={(e) => onChange({ carbs: e.target.value })}
          className="w-20 rounded-xl border border-gray-200 bg-white px-2 py-1 text-sm"
        />
      </td>
      <td className="px-3 py-2">
        <input
          inputMode="decimal"
          value={it.fat ?? ""}
          onChange={(e) => onChange({ fat: e.target.value })}
          className="w-20 rounded-xl border border-gray-200 bg-white px-2 py-1 text-sm"
        />
      </td>
      <td className="px-3 py-2 text-sm text-gray-700">{fmt1(totalCalories)}</td>
      <td className="px-3 py-2 text-sm text-gray-700">{fmt1(totalProtein)}</td>
      <td className="px-3 py-2 text-sm text-gray-700">{fmt1(totalCarbs)}</td>
      <td className="px-3 py-2 text-sm text-gray-700">{fmt1(totalFat)}</td>
      <td className="px-3 py-2 text-right">
        <button onClick={onRemove} className="rounded-xl bg-white px-3 py-1.5 text-sm font-medium text-red-700 shadow-sm ring-1 ring-red-200 hover:bg-red-50">Delete</button>
      </td>
    </tr>
  );
}

function ManualFoodForm({ onAdd }) {
  const [name, setName] = useState("");
  const [serving, setServing] = useState("");
  const [qty, setQty] = useState("1");
  const [calories, setCalories] = useState("");
  const [protein, setProtein] = useState("");
  const [carbs, setCarbs] = useState("");
  const [fat, setFat] = useState("");

  return (
    <div className="mt-2 space-y-2">
      <Field label="Food name">
        <input value={name} onChange={(e) => setName(e.target.value)} className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2" placeholder="e.g., Greek yogurt" />
      </Field>
      <div className="grid grid-cols-2 gap-2">
        <Field label="Serving (optional)">
          <input value={serving} onChange={(e) => setServing(e.target.value)} className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2" placeholder="e.g., 1 cup" />
        </Field>
        <Field label="Quantity">
          <input inputMode="decimal" value={qty} onChange={(e) => setQty(e.target.value)} className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2" placeholder="e.g., 1" />
        </Field>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <Field label="Calories (per serving)">
          <input inputMode="numeric" value={calories} onChange={(e) => setCalories(e.target.value)} className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2" placeholder="e.g., 120" />
        </Field>
        <Field label="Protein g (per serving)">
          <input inputMode="decimal" value={protein} onChange={(e) => setProtein(e.target.value)} className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2" placeholder="e.g., 15" />
        </Field>
        <Field label="Carbs g (per serving)">
          <input inputMode="decimal" value={carbs} onChange={(e) => setCarbs(e.target.value)} className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2" placeholder="e.g., 10" />
        </Field>
        <Field label="Fat g (per serving)">
          <input inputMode="decimal" value={fat} onChange={(e) => setFat(e.target.value)} className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2" placeholder="e.g., 3" />
        </Field>
      </div>

      <button
        onClick={() => {
          const n = name.trim();
          if (!n) return;
          onAdd(
            normalizeFoodItem({
              name: n,
              serving: serving.trim(),
              qty: qty === "" ? 1 : qty,
              calories: String(calories).trim(),
              protein: String(protein).trim(),
              carbs: String(carbs).trim(),
              fat: String(fat).trim(),
              source: "manual",
            })
          );
          setName("");
          setServing("");
          setQty("1");
          setCalories("");
          setProtein("");
          setCarbs("");
          setFat("");
        }}
        className="mt-1 rounded-xl bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-black"
      >
        Add to meal
      </button>
      <div className="mt-2 text-xs text-gray-600">Macros are per-serving; quantity multiplies totals.</div>
    </div>
  );
}

function FoodSearch({ onPick }) {
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("idle");
  const [error, setError] = useState("");
  const [results, setResults] = useState([]);

  async function run() {
    const query = q.trim();
    if (!query) return;

    setStatus("loading");
    setError("");
    try {
      const data = await fdcSearch({ query });
      const foods = Array.isArray(data?.foods) ? data.foods : [];
      setResults(foods);
      setStatus("idle");
    } catch (e) {
      setStatus("error");
      setError(e?.message || "Search failed.");
    }
  }

  return (
    <div className="mt-2">
      <div className="flex gap-2">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2"
          placeholder="Search foods…"
          onKeyDown={(e) => {
            if (e.key === "Enter") run();
          }}
        />
        <button onClick={run} className="rounded-xl bg-white px-4 py-2 text-sm font-medium text-gray-900 shadow-sm ring-1 ring-gray-200 hover:bg-gray-100">Search</button>
      </div>

      {status === "error" ? <div className="mt-2 text-xs text-red-700">{error}</div> : null}

      <div className="mt-3 max-h-[260px] overflow-auto rounded-xl border border-gray-100 bg-white">
        {status === "loading" ? (
          <div className="p-4 text-sm text-gray-600">Searching…</div>
        ) : results.length === 0 ? (
          <div className="p-4 text-sm text-gray-600">No results yet. Search for a food (e.g., “banana”, “chicken breast”).</div>
        ) : (
          <ul className="divide-y divide-gray-100">
            {results.map((r) => {
              const macros = extractMacrosFromFDC(r);
              return (
                <li key={r.fdcId || uid()} className="p-3">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="text-sm font-medium">{r.description || "Food"}</div>
                      <div className="mt-0.5 text-xs text-gray-500">
                        {r.brandName ? `${r.brandName} · ` : ""}
                        {r.dataType ? `${r.dataType} · ` : ""}
                        {r.servingSize ? `${r.servingSize} ${r.servingSizeUnit || ""}` : ""}
                      </div>
                      <div className="mt-1 text-xs text-gray-600">
                        Calories: <span className="font-medium">{macros.calories || "—"}</span> · Protein: <span className="font-medium">{macros.protein || "—"}</span>g · Carbs: <span className="font-medium">{macros.carbs || "—"}</span>g · Fat: <span className="font-medium">{macros.fat || "—"}</span>g
                      </div>
                    </div>
                    <button
                      onClick={() =>
                        onPick(
                          normalizeFoodItem({
                            name: r.description || "Food",
                            brand: r.brandName || "",
                            serving: r.servingSize && r.servingSizeUnit ? `${r.servingSize} ${r.servingSizeUnit}` : "",
                            qty: 1,
                            ...macros,
                            source: "fdc",
                            fdcId: r.fdcId,
                          })
                        )
                      }
                      className="rounded-xl bg-gray-900 px-3 py-2 text-sm font-medium text-white hover:bg-black"
                    >
                      Add
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <div className="mt-2 text-xs text-gray-600">FDC results vary by data source; macros are best-effort extracted.</div>
    </div>
  );
}

function FoodItemRow({ item, onChange, onRemove }) {
  const it = normalizeFoodItem(item);
  const q = clamp(it.qty, 0, 100);
  const totalCalories = Math.round(num(it.calories) * q);
  const totalProtein = Math.round(num(it.protein) * q * 10) / 10;
  const totalCarbs = Math.round(num(it.carbs) * q * 10) / 10;
  const totalFat = Math.round(num(it.fat) * q * 10) / 10;

  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <div className="text-sm font-semibold">{it.name}</div>
          <div className="mt-0.5 text-xs text-gray-500">
            {it.brand ? `${it.brand} · ` : ""}
            {it.serving || ""}
            {it.source ? ` · ${it.source}` : ""}
          </div>
          <div className="mt-1 text-xs text-gray-600">
            Total ({q}×): <span className="font-medium">{totalCalories}</span> cal · P <span className="font-medium">{totalProtein}</span>g · C <span className="font-medium">{totalCarbs}</span>g · F <span className="font-medium">{totalFat}</span>g
          </div>
        </div>
        <button onClick={onRemove} className="rounded-xl bg-white px-3 py-2 text-sm font-medium text-red-700 shadow-sm ring-1 ring-red-200 hover:bg-red-50">Delete</button>
      </div>

      <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-5">
        <MiniNumber label="Qty" value={it.qty} onChange={(v) => onChange({ qty: v })} />
        <MiniNumber label="Calories (per)" value={it.calories} onChange={(v) => onChange({ calories: v })} />
        <MiniNumber label="Protein g (per)" value={it.protein} onChange={(v) => onChange({ protein: v })} />
        <MiniNumber label="Carbs g (per)" value={it.carbs} onChange={(v) => onChange({ carbs: v })} />
        <MiniNumber label="Fat g (per)" value={it.fat} onChange={(v) => onChange({ fat: v })} />
      </div>

      <div className="mt-2 text-xs text-gray-600">Adjust per-serving macros or quantity to match what you ate.</div>
    </div>
  );
}

function MiniNumber({ label, value, onChange }) {
  return (
    <label className="block">
      <div className="mb-1 text-[11px] font-medium text-gray-600">{label}</div>
      <input inputMode="decimal" value={value ?? ""} onChange={(e) => onChange(e.target.value)} className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm" />
    </label>
  );
}

function buildMacroTimeline(days, limit = 30) {
  const safe = Array.isArray(days) ? days : [];
  const sorted = safe
    .slice()
    .filter((d) => d?.date)
    .sort((a, b) => (a.date < b.date ? -1 : 1));

  return sorted.slice(-limit).map((d) => {
    const totals = calcDayTotals(d);
    const date = new Date(d.date);
    return {
      iso: d.date,
      dateLabel: date.toLocaleDateString(undefined, { month: "short", day: "2-digit" }),
      calories: totals.calories,
      protein: totals.protein,
      carbs: totals.carbs,
      fat: totals.fat,
      weight: d?.weight === undefined || d?.weight === null || d?.weight === "" ? null : Number(d.weight),
    };
  });
}

function GoalInput({ label, value, onChange }) {
  return (
    <label className="block">
      <div className="mb-1 text-[11px] font-medium text-gray-600">{label}</div>
      <input
        inputMode="decimal"
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm"
        placeholder="—"
      />
    </label>
  );
}

function GoalProgress({ label, goal, actual, suffix = "" }) {
  const g = num(goal);
  const a = num(actual);
  const pct = g > 0 ? Math.round((a / g) * 100) : null;
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-2">
      <div className="flex items-center justify-between gap-2">
        <div className="text-[11px] font-medium text-gray-600">{label}</div>
        {pct !== null ? <div className="text-[11px] text-gray-500">{pct}%</div> : <div className="text-[11px] text-gray-400">Set goal</div>}
      </div>
      <div className="mt-1 text-sm font-semibold">
        {a}
        {suffix} <span className="text-xs font-normal text-gray-500">/ {g || "—"}{suffix}</span>
      </div>
    </div>
  );
}

function MacroTimeline({ days, goals, mode = "macros", range = 30 }) {
  const data = useMemo(() => buildMacroTimeline(days, range), [days, range]);
  if (!data || data.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-gray-200 p-6 text-sm text-gray-600">
        No nutrition days yet — log meals to see your timeline.
      </div>
    );
  }

  const goalP = num(goals?.protein);
  const goalC = num(goals?.carbs);
  const goalF = num(goals?.fat);
  const goalCal = num(goals?.calories);

  
  return (
    <div style={{ width: "100%", height: 320 }}>
      <ResponsiveContainer>
        <LineChart data={data} margin={{ top: 10, right: 20, left: 0, bottom: 10 }}>
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis dataKey="dateLabel" />
          <YAxis yAxisId="left" />
          <Tooltip />
          <Legend />

          {mode === "calories" ? (
            <>
              {goalCal > 0 ? <ReferenceLine y={goalCal} strokeDasharray="4 4" yAxisId="left" /> : null}
              <Line type="monotone" dataKey="calories" name="Calories" dot={false} yAxisId="left" />
                          </>
          ) : (
            <>
              {goalP > 0 ? <ReferenceLine y={goalP} strokeDasharray="4 4" yAxisId="left" /> : null}
              {goalC > 0 ? <ReferenceLine y={goalC} strokeDasharray="4 4" yAxisId="left" /> : null}
              {goalF > 0 ? <ReferenceLine y={goalF} strokeDasharray="4 4" yAxisId="left" /> : null}
              <Line type="monotone" dataKey="protein" name="Protein (g)" dot={false} yAxisId="left" />
              <Line type="monotone" dataKey="carbs" name="Carbs (g)" dot={false} yAxisId="left" />
              <Line type="monotone" dataKey="fat" name="Fat (g)" dot={false} yAxisId="left" />
              
            </>
          )}
        </LineChart>
      </ResponsiveContainer>
      <div className="mt-2 text-xs text-gray-600">Shows logged days only. Goals render as dashed reference lines when set.</div>
    </div>
  );
}

function WeightCaloriesChart({ days, range = 30 }) {
  const data = useMemo(() => {
    const safe = Array.isArray(days) ? days : [];
    const sorted = safe
      .slice()
      .filter((d) => d?.date)
      .sort((a, b) => (a.date < b.date ? -1 : 1))
      .slice(-range)
      .map((d) => {
        const totals = calcDayTotals(d);
        const date = new Date(d.date);
        const weight = d?.weight === "" || d?.weight == null ? null : Number(d.weight);
        return {
          iso: d.date,
          dateLabel: date.toLocaleDateString(undefined, { month: "short", day: "2-digit" }),
          calories: totals.calories,
          weight,
        };
      });

    // 7-day rolling average calories
    for (let i = 0; i < sorted.length; i++) {
      const start = Math.max(0, i - 6);
      const window = sorted.slice(start, i + 1);
      const avg = window.reduce((s, x) => s + num(x.calories), 0) / window.length;
      sorted[i].caloriesAvg7 = round1(avg);
    }

    return sorted;
  }, [days, range]);

  const hasWeight = data.some((d) => d.weight != null && Number.isFinite(d.weight));

  if (!data.length) {
    return <div className="rounded-xl border border-dashed border-gray-200 p-6 text-sm text-gray-600">No data yet.</div>;
  }

  return (
    <div style={{ width: "100%", height: 320 }}>
      <ResponsiveContainer>
        <LineChart data={data} margin={{ top: 10, right: 20, left: 0, bottom: 10 }}>
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis dataKey="dateLabel" />
          <YAxis yAxisId="cal" />
          {hasWeight ? <YAxis yAxisId="wt" orientation="right" /> : null}
          <Tooltip />
          <Legend />

          <Line type="monotone" dataKey="calories" name="Calories" dot={false} yAxisId="cal" />
          <Line type="monotone" dataKey="caloriesAvg7" name="Calories (7d avg)" dot={false} yAxisId="cal" />
          {hasWeight ? <Line type="monotone" dataKey="weight" name="Weight" dot={false} yAxisId="wt" /> : null}
        </LineChart>
      </ResponsiveContainer>
      <div className="mt-2 text-xs text-gray-600">Calories include a 7-day rolling average. Weight uses the right axis.</div>
    </div>
  );
}

function WeeklyAverages({ days, anchorISO }) {
  const data = useMemo(() => {
    const safe = Array.isArray(days) ? days : [];
    const anchor = anchorISO ? new Date(anchorISO) : new Date();
    // Build the last 7 calendar days (including anchor)
    const byISO = new Map(safe.map((d) => [toISODateInput(d.date), d]));
    const items = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date(anchor);
      d.setDate(d.getDate() - i);
      const key = d.toLocaleDateString("en-CA"); // YYYY-MM-DD
      const found = byISO.get(key);
      const totals = found ? calcDayTotals(found) : { calories: 0, protein: 0, carbs: 0, fat: 0 };
      items.push(totals);
    }
    const sum = items.reduce(
      (s, t) => ({
        calories: s.calories + num(t.calories),
        protein: s.protein + num(t.protein),
        carbs: s.carbs + num(t.carbs),
        fat: s.fat + num(t.fat),
      }),
      { calories: 0, protein: 0, carbs: 0, fat: 0 }
    );
    return {
      calories: Math.round(sum.calories / 7),
      protein: Math.round((sum.protein / 7) * 10) / 10,
      carbs: Math.round((sum.carbs / 7) * 10) / 10,
      fat: Math.round((sum.fat / 7) * 10) / 10,
    };
  }, [days, anchorISO]);

  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-4">
      <div className="text-sm font-semibold">Weekly averages (last 7 days)</div>
      <div className="mt-2 grid grid-cols-2 gap-3 text-sm">
        <Metric label="Avg Calories" value={data.calories} />
        <Metric label="Avg Protein" value={data.protein} suffix="g" />
        <Metric label="Avg Carbs" value={data.carbs} suffix="g" />
        <Metric label="Avg Fat" value={data.fat} suffix="g" />
      </div>
      <div className="mt-2 text-xs text-gray-600">Includes days with no log as 0, so it reflects consistency across the week.</div>
    </div>
  );
}

function NutritionHistory({ days, onEdit }) {
  if (!days || days.length === 0) {
    return <div className="rounded-xl border border-dashed border-gray-200 p-6 text-sm text-gray-600">No nutrition logs yet.</div>;
  }

  const sorted = days.slice().sort((a, b) => (a.date < b.date ? 1 : -1));

  return (
    <div className="space-y-3">
      {sorted.map((d) => {
        const totals = calcDayTotals(d);
        return (
          <div key={d.id || d.date} className="rounded-2xl border border-gray-200 bg-white p-4">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <div className="text-sm font-semibold">{new Date(d.date).toLocaleDateString()}</div>
                <div className="mt-1 text-xs text-gray-600">
                  Calories: <span className="font-medium">{totals.calories}</span> · Protein: <span className="font-medium">{totals.protein}</span>g · Carbs: <span className="font-medium">{totals.carbs}</span>g · Fat: <span className="font-medium">{totals.fat}</span>g
                  {d.weight ? (
                    <>
                      <span className="mx-2">·</span>
                      Weight: <span className="font-medium">{d.weight}</span>
                    </>
                  ) : null}
                </div>
              </div>
              <button onClick={() => onEdit(d.date)} className="rounded-xl bg-gray-900 px-3 py-2 text-sm font-medium text-white hover:bg-black">Edit</button>
            </div>
            {d.notes ? <div className="mt-2 whitespace-pre-wrap text-sm text-gray-700">{d.notes}</div> : null}
          </div>
        );
      })}
    </div>
  );
}
