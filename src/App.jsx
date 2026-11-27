import React, { useState, useMemo, useEffect, useCallback } from "react";
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine
} from "recharts";
import {
  TrendingUp, TrendingDown, Minus, AlertTriangle, Sparkles, Flame,
  Activity, ChevronRight, CheckCircle2, Pencil, User,
  Home as HomeIcon, Phone, ClipboardList, ArrowLeft,
  PhoneCall, ShieldCheck, ListChecks, LogOut, Lock, Eye, EyeOff,
  Users, FileText, CalendarDays, Pill, MonitorSmartphone, HeartHandshake, Dumbbell, CalendarClock, MessageSquare, GraduationCap, BookOpen
} from "lucide-react";
import { supabase } from "./supabaseClient.js";
import CarePlan from "./CarePlan.jsx";
import { AppointmentsView, ReminderAlarm, useAppointments, useReminderAlarm } from "./Appointments.jsx";
import { whenLabel, fmtApptDate, fmtApptTime } from "./appointments.js";
import { telHref, ageFromDob, OFFICE_PHONE, resolveCarePlan } from "./carePlan.js";
import { emptyProfile } from "./demoPatient.js";
import CallActions from "./CallActions.jsx";
import NotesCard from "./Notes.jsx";
import ManageAccounts from "./ManageAccounts.jsx";
import { MyShifts, ShiftBanner, useMyShifts } from "./Shifts.jsx";
import { PatientVisits, useVisits } from "./Visits.jsx";
import { combineDays, worstSymptoms, carePlanFollowed } from "./progress.js";
import { useProgress } from "./care/useProgress.js";
import { RecoveryCard, CarePlanCard } from "./ProgressCards.jsx";
import { LogoMark } from "./Logo.jsx";
import { registerAvatars, ProfilePhoto, Avatar } from "./Avatar.jsx";
import MessagesView, { useMessaging } from "./Messages.jsx";
import { BirthdayFields, birthdayText } from "./Birthdays.jsx";
import { ProfileRequestNotice, EmailNoticeSwitch } from "./ProfileRequests.jsx";
import MyTrainingView, { useMyTraining } from "./training/MyTraining.jsx";
import TrainingAdmin from "./training/TrainingAdmin.jsx";
import ActionTaken, { latestSevereDate, describeAction } from "./ActionTaken.jsx";
import { shiftsOnNow, occurrences, shiftWindowStatus } from "./shifts.js";
import { TodayTop, TodayTools } from "./care/TodayExtras.jsx";
import { useCareToday } from "./care/useCare.js";
import { isBefore, taskOpensAt } from "./care/timeOfDay.js";
import { openMeals } from "./care/meals.js";
import Medication from "./care/Medication.jsx";
import Exercises from "./care/Exercises.jsx";
import { todaysProgress } from "./care/medication.js";
import { queueCheckin, flushQueue, isNetworkError, pendingCount } from "./offlineQueue.js";
import { SIZES, getTextSize, setTextSize } from "./textSize.js";
import PatientsHome from "./PatientsHome.jsx";
import MemberHome from "./MemberHome.jsx";
import PatientDetailsEditor from "./PatientDetailsEditor.jsx";
import HowItWorks from "./HowItWorks.jsx";

/* ---------------------------------------------------------
   Design tokens
--------------------------------------------------------- */
const colors = {
  bg: "#FAF6EF",
  card: "#FFFFFF",
  cardMuted: "#F1ECE0",
  hairline: "#E5DFD1",
  ink: "#20261F",
  inkSoft: "#5C6357",
  inkFaint: "#6B7266",
  sage: "#3F6C51",
  sageDeep: "#2C4E3A",
  sageTint: "#E3EBE0",
  gold: "#B98A2E",
  goldTint: "#F3E7CC",
  rust: "#A24632",
  rustTint: "#F3DAD2",
  teal: "#4C7A82",
  tealTint: "#E5EEEF",
  none: "#C7CEC0",
  mild: "#D8B04A",
  moderate: "#CB7C3B",
  severe: "#A24632",
};

const severityColor = (level) =>
  [colors.none, colors.mild, colors.moderate, colors.severe][level];
const severityLabel = (level) => ["None", "Mild", "Moderate", "Severe"][level];

// Ordered to match the American Stroke Association's B.E. F.A.S.T. mnemonic —
// Balance, Eyes, Face, Arms, Speech are all core warning signs; Time isn't a
// symptom to rate, it's captured as "when did this start" guidance instead.
const SYMPTOMS = [
  { key: "balance", label: "Balance or dizziness", core: true },
  { key: "vision", label: "Vision changes", core: true },
  { key: "face", label: "Face drooping", core: true },
  { key: "arm", label: "Arm weakness or numbness", core: true },
  { key: "speech", label: "Speech difficulty", core: true },
  { key: "headache", label: "Headache", core: false },
  { key: "fatigue", label: "Fatigue", core: false },
];

const fmtDate = (d) => d.toLocaleDateString(undefined, { weekday: "short", day: "numeric" });
const fmtDateFull = (d) => d.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });
const toISODate = (d) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const monthShort = (d) => d.toLocaleDateString(undefined, { month: "short" });
const weekdayShort = (d) => d.toLocaleDateString(undefined, { weekday: "short" });

const wellnessScore = (symptoms) => {
  const vals = SYMPTOMS.map((s) => symptoms[s.key] ?? 0);
  const avg = vals.reduce((a, b) => a + b, 0) / vals.length;
  return Math.round(100 - (avg / 3) * 100);
};

function daysSince(dateStr) {
  if (!dateStr) return null;
  const start = new Date(dateStr + "T00:00:00");
  const diff = Math.floor((new Date().setHours(0, 0, 0, 0) - start.setHours(0, 0, 0, 0)) / 86400000);
  return diff >= 0 ? diff : null;
}

function lastCheckinLabel(entries, hasLoggedToday) {
  if (hasLoggedToday) return "Today";
  if (entries.length === 0) return "Not yet";
  const days = Math.round(
    (new Date().setHours(0, 0, 0, 0) - new Date(entries[entries.length - 1].date).setHours(0, 0, 0, 0)) / 86400000
  );
  if (days <= 0) return "Today";
  if (days === 1) return "Yesterday";
  return `${days} days ago`;
}

function recoveryLevelFallback(score) {
  if (score == null) return { label: "Unknown", emoji: "⚪" };
  if (score >= 85) return { label: "Good", emoji: "🟢" };
  if (score >= 65) return { label: "Mild", emoji: "🟡" };
  if (score >= 40) return { label: "Moderate", emoji: "🟠" };
  return { label: "Severe", emoji: "🔴" };
}

function isSevereEntry(symptoms) {
  return SYMPTOMS.some((s) => symptoms[s.key] === 3);
}

// The only place calling 911 or the office is offered: severe symptoms ("emergency"), or a steep
// fall in the recovery score / a symptom jumping by two levels ("urgent"). Only recent check-ins count.
function computeAlert(entries) {
  if (!entries.length) return null;
  const latest = entries[entries.length - 1];
  const ageDays = Math.round((new Date().setHours(0, 0, 0, 0) - new Date(latest.date).setHours(0, 0, 0, 0)) / 86400000);
  if (ageDays > 2) return null;

  let level = null;
  const reasons = [];

  const severe = SYMPTOMS.filter((s) => latest.symptoms[s.key] === 3);
  if (severe.length) {
    level = "emergency";
    reasons.push(`${severe.map((s) => s.label).join(", ")} ${severe.length === 1 ? "is" : "are"} rated Severe.`);
  }

  if (entries.length >= 2) {
    const current = wellnessScore(latest.symptoms);
    const before = entries.slice(-4, -1).map((e) => wellnessScore(e.symptoms));
    const reference = Math.max(...before);
    if (reference - current >= 20) {
      level = level || "urgent";
      reasons.push(`The recovery score fell steeply, from ${reference} to ${current}.`);
    }
    const jumps = detectAnomalies(entries).filter((a) => !a.severe);
    if (jumps.length) {
      level = level || "urgent";
      reasons.push(jumps[0].message);
    }
  }

  return level ? { level, reasons } : null;
}

/* ---------------------------------------------------------
   Trend + anomaly + streak logic
--------------------------------------------------------- */
function computeSymptomTrends(entries) {
  if (entries.length < 4) return {};
  const n = entries.length;
  const recent = entries.slice(Math.max(0, n - 3));
  const prior = entries.slice(Math.max(0, n - 7), Math.max(0, n - 3));
  const trends = {};
  SYMPTOMS.forEach((s) => {
    const recentAvg = recent.reduce((a, e) => a + e.symptoms[s.key], 0) / recent.length;
    const priorAvg = prior.length
      ? prior.reduce((a, e) => a + e.symptoms[s.key], 0) / prior.length
      : recentAvg;
    const delta = recentAvg - priorAvg;
    let direction = "stable";
    if (delta <= -0.4) direction = "improving";
    else if (delta >= 0.4) direction = "worsening";
    trends[s.key] = { direction, recentAvg, priorAvg, delta };
  });
  return trends;
}

function detectAnomalies(entries) {
  if (entries.length < 2) return [];
  const today = entries[entries.length - 1];
  const yesterday = entries[entries.length - 2];
  const alerts = [];
  SYMPTOMS.forEach((s) => {
    const todayVal = today.symptoms[s.key];
    const yestVal = yesterday.symptoms[s.key];
    const jump = todayVal - yestVal;
    if (jump >= 2) {
      alerts.push({
        key: s.key,
        label: s.label,
        message: `${s.label} changed from ${severityLabel(yestVal)} to ${severityLabel(todayVal)} compared with the previous check-in.`,
        severe: todayVal === 3,
      });
    } else if (s.core && todayVal === 3) {
      alerts.push({
        key: s.key,
        label: s.label,
        message: `${s.label} is rated Severe today — a core stroke warning sign.`,
        severe: true,
      });
    }
  });
  return alerts;
}

function scoreDelta(entries) {
  const n = entries.length;
  if (n < 7) return null;
  const recentScore = entries.slice(n - 3).reduce((a, e) => a + wellnessScore(e.symptoms), 0) / 3;
  const earlyScore = entries.slice(0, 3).reduce((a, e) => a + wellnessScore(e.symptoms), 0) / 3;
  return Math.round(recentScore - earlyScore);
}

function computeStreak(entries) {
  let streak = 0;
  for (let i = entries.length - 1; i >= 0; i--) {
    if (entries[i].logged) streak++;
    else break;
  }
  return streak;
}

function coreSymptomsResolved(symptoms) {
  return SYMPTOMS.filter((s) => s.core).every((s) => symptoms[s.key] === 0);
}

function computeBadges(entries, trends, streak) {
  const badges = [];
  if (streak >= 7) badges.push({ label: `${streak}-day streak`, icon: Flame, tone: "gold" });
  if (entries.length === 0) return badges;
  const latest = entries[entries.length - 1].symptoms;
  if (coreSymptomsResolved(latest)) {
    badges.push({ label: "BE FAST symptoms resolved", icon: CheckCircle2, tone: "sage" });
  }
  if (trends.fatigue?.direction === "improving") {
    badges.push({ label: "Fatigue improving", icon: TrendingDown, tone: "sage" });
  }
  return badges;
}

function computeMilestones(entries, streak, profile) {
  const list = [];
  if (streak >= 7) list.push("Completed 7 consecutive check-ins");
  if (entries.length && coreSymptomsResolved(entries[entries.length - 1].symptoms)) {
    list.push("BE FAST symptoms resolved");
  }
  if (profile.recoveryGoals?.length) list.push("Recovery goals set");
  return list;
}

/* ---------------------------------------------------------
   Small shared building blocks
--------------------------------------------------------- */
function TrendIcon({ direction, size = 15 }) {
  if (direction === "improving") return <TrendingDown size={size} color={colors.sage} strokeWidth={2.4} />;
  if (direction === "worsening") return <TrendingUp size={size} color={colors.rust} strokeWidth={2.4} />;
  return <Minus size={size} color={colors.inkFaint} strokeWidth={2.4} />;
}

function SeverityPicker({ value, onChange }) {
  return (
    <div style={{ display: "flex", gap: 6 }}>
      {[0, 1, 2, 3].map((lvl) => {
        const active = value === lvl;
        return (
          <button
            key={lvl}
            onClick={() => onChange(lvl)}
            style={{
              flex: 1, padding: "10px 4px", borderRadius: 10,
              border: active ? "none" : `1px solid ${colors.hairline}`,
              background: active ? severityColor(lvl) : "#fff",
              color: active ? "#fff" : colors.inkSoft,
              fontSize: 13, fontWeight: active ? 700 : 500, cursor: "pointer",
            }}
          >
            {severityLabel(lvl)}
          </button>
        );
      })}
    </div>
  );
}

function SymptomRow({ symptom, value, onChange, invalid }) {
  return (
    <div style={{ padding: "16px 0", borderBottom: `1px solid ${colors.hairline}` }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
        <span style={{ fontSize: 15.5, fontWeight: 600, color: colors.ink }}>{symptom.label}</span>
        {symptom.core && (
          <span style={{ fontSize: 12.5, fontWeight: 700, letterSpacing: 0.4, color: colors.sageDeep, background: colors.sageTint, padding: "2px 7px", borderRadius: 999 }}>
            BE FAST
          </span>
        )}
        <span style={{ fontSize: 12.5, fontWeight: 700, color: colors.rust }}>*</span>
      </div>
      <SeverityPicker value={value} onChange={onChange} />
      {invalid && (
        <div style={{ fontSize: 13, color: colors.rust, marginTop: 7, fontWeight: 600 }}>
          Please select a severity for this symptom.
        </div>
      )}
    </div>
  );
}

function MiniBars({ values }) {
  return (
    <div style={{ display: "flex", gap: 3, alignItems: "flex-end", height: 26 }}>
      {values.map((v, i) => (
        <div key={i} title={severityLabel(v)} style={{ width: 6, height: Math.max(4, (v / 3) * 26), borderRadius: 2, background: severityColor(v), opacity: i === values.length - 1 ? 1 : 0.55 }} />
      ))}
    </div>
  );
}

function Card({ children, style }) {
  return (
    <div style={{ background: colors.card, borderRadius: 18, boxShadow: "0 1px 3px rgba(32,38,31,0.06), 0 6px 16px rgba(32,38,31,0.05)", ...style }}>
      {children}
    </div>
  );
}

/* ---------------------------------------------------------
   Top bar + bottom navigation
--------------------------------------------------------- */
function TopBar({ setView }) {
  return (
    <button
      onClick={() => setView("home")}
      style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 4px", marginBottom: 18, border: "none", background: "none", cursor: "pointer" }}
    >
      <LogoMark size={36} radius={22} />
      <span style={{ fontFamily: "Fraunces, serif", fontSize: 22, fontWeight: 600, color: colors.sageDeep }}>
        Strovia
      </span>
    </button>
  );
}

// True on a laptop or any wide screen: the app then shows a menu down the left and uses two columns where it helps.
function useWide(min = 1000) {
  const query = `(min-width: ${min}px)`;
  const [wide, setWide] = useState(() => typeof window !== "undefined" && !!window.matchMedia && window.matchMedia(query).matches);
  useEffect(() => {
    if (!window.matchMedia) return undefined;
    const mq = window.matchMedia(query);
    const on = () => setWide(mq.matches);
    on();
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, [query]);
  return wide;
}

// The main menu, the same on the phone's bottom bar and the laptop's side menu.
const navTabs = (role) => [
  { key: "home", label: "Home", icon: HomeIcon },
  ...(role === "caregiver" ? [{ key: "shifts", label: "My shifts", icon: CalendarClock }] : []),
  ...(role === "admin" ? [{ key: "manage", label: "Manage", icon: ShieldCheck }] : []),
  ...(role === "admin" || role === "caregiver" ? [{ key: "messages", label: "Messages", icon: MessageSquare }, { key: "training", label: "Training", icon: GraduationCap }] : []),
  { key: "guide", label: "How it works", icon: BookOpen },
  { key: "profile", label: "Profile", icon: User },
];
const navActive = (view) => (view === "profile" || view === "manage" || view === "shifts" || view === "messages" || view === "training" || view === "guide" ? view : "home");

// The laptop version of the menu: down the left side, with the logo at the top and who is signed in at the bottom.
function SideNav({ view, setView, role, pending = 0, unread = 0, trainingBadge = 0, name, userId }) {
  const active = navActive(view);
  const roleWord = role === "admin" ? "Administrator" : role === "caregiver" ? "Caregiver" : "Family";
  return (
    <nav className="no-print" aria-label="Main menu" style={{ width: 232, flexShrink: 0, position: "sticky", top: 0, height: "100vh", boxSizing: "border-box", background: "#fff", borderRight: `1px solid ${colors.hairline}`, padding: "20px 14px", display: "flex", flexDirection: "column" }}>
      <button onClick={() => setView("home")} style={{ display: "flex", alignItems: "center", gap: 10, border: "none", background: "none", cursor: "pointer", padding: "0 6px", marginBottom: 24 }}>
        <LogoMark size={36} radius={22} />
        <span style={{ fontFamily: "Fraunces, serif", fontSize: 22, fontWeight: 600, color: colors.sageDeep }}>Strovia</span>
      </button>
      {navTabs(role).map((t) => {
        const on = active === t.key;
        return (
          <button key={t.key} onClick={() => setView(t.key)} aria-current={on ? "page" : undefined}
            style={{ display: "flex", alignItems: "center", gap: 11, width: "100%", textAlign: "left", border: "none", cursor: "pointer", padding: "11px 12px", borderRadius: 11, marginBottom: 3, fontSize: 14, fontWeight: on ? 700 : 600, background: on ? colors.sageTint : "transparent", color: on ? colors.sageDeep : colors.inkSoft }}>
            <t.icon size={18} strokeWidth={on ? 2.4 : 2} />
            <span style={{ flex: 1 }}>{t.label}</span>
            {t.key === "manage" && pending > 0 && <span aria-label={`${pending} waiting for approval`} style={{ minWidth: 18, height: 18, padding: "0 5px", boxSizing: "border-box", borderRadius: 999, background: colors.rust, color: "#fff", fontSize: 11, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center" }}>{pending}</span>}
            {t.key === "messages" && unread > 0 && <span aria-label={`${unread} unread messages`} style={{ minWidth: 18, height: 18, padding: "0 5px", boxSizing: "border-box", borderRadius: 999, background: colors.rust, color: "#fff", fontSize: 11, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center" }}>{unread}</span>}
            {t.key === "training" && trainingBadge > 0 && <span aria-label={`${trainingBadge} trainings need attention`} style={{ minWidth: 18, height: 18, padding: "0 5px", boxSizing: "border-box", borderRadius: 999, background: colors.rust, color: "#fff", fontSize: 11, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center" }}>{trainingBadge}</span>}
          </button>
        );
      })}
      <button onClick={() => setView("profile")} aria-label="Open your profile" style={{ marginTop: "auto", borderTop: `1px solid ${colors.hairline}`, borderLeft: "none", borderRight: "none", borderBottom: "none", background: "none", cursor: "pointer", textAlign: "left", font: "inherit", padding: "12px 8px 0", fontSize: 13, color: colors.inkSoft, lineHeight: 1.4, display: "flex", alignItems: "center", gap: 10 }}>
        <Avatar userId={userId} name={name} size={40} fontSize={15} tone={[colors.sage, "#fff"]} />
        <span style={{ minWidth: 0 }}>
          <span style={{ display: "block", fontWeight: 700, color: colors.ink, overflow: "hidden", textOverflow: "ellipsis" }}>{name}</span>
          <span style={{ display: "block" }}>{roleWord}</span>
        </span>
      </button>
    </nav>
  );
}

function BottomNav({ view, setView, role, pending = 0, unread = 0, trainingBadge = 0 }) {
  const tabs = navTabs(role);
  // Every patient screen belongs to Home.
  const active = navActive(view);
  return (
    <div className="no-print bottom-nav" style={{
      position: "fixed", left: 0, right: 0, bottom: 0, background: "#fff",
      borderTop: `1px solid ${colors.hairline}`, display: "flex", justifyContent: "center",
      boxShadow: "0 -2px 12px rgba(32,38,31,0.06)", zIndex: 20,
    }}>
      <div style={{ width: "100%", maxWidth: 760, display: "flex", overflowX: "auto" }}>
        {tabs.map((t) => {
          const isActive = active === t.key;
          return (
            <button
              key={t.key}
              onClick={() => setView(t.key)}
              style={{
                flex: "1 0 60px", minWidth: 0, border: "none", background: "none", cursor: "pointer",
                padding: "10px 1px 10px", display: "flex", flexDirection: "column",
                alignItems: "center", gap: 3,
              }}
            >
              <span style={{ position: "relative", display: "flex" }}>
                <t.icon size={20} color={isActive ? colors.sageDeep : colors.inkFaint} strokeWidth={isActive ? 2.4 : 2} />
                {t.key === "manage" && pending > 0 && (
                  <span aria-label={`${pending} waiting for approval`} style={{ position: "absolute", top: -5, right: -9, minWidth: 16, height: 16, padding: "0 4px", boxSizing: "border-box", borderRadius: 999, background: colors.rust, color: "#fff", fontSize: 11, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center" }}>
                    {pending}
                  </span>
                )}
                {t.key === "messages" && unread > 0 && (
                  <span aria-label={`${unread} unread messages`} style={{ position: "absolute", top: -5, right: -9, minWidth: 16, height: 16, padding: "0 4px", boxSizing: "border-box", borderRadius: 999, background: colors.rust, color: "#fff", fontSize: 11, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center" }}>
                    {unread}
                  </span>
                )}
                {t.key === "training" && trainingBadge > 0 && (
                  <span aria-label={`${trainingBadge} trainings need attention`} style={{ position: "absolute", top: -5, right: -9, minWidth: 16, height: 16, padding: "0 4px", boxSizing: "border-box", borderRadius: 999, background: colors.rust, color: "#fff", fontSize: 11, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center" }}>
                    {trainingBadge}
                  </span>
                )}
              </span>
              <span style={{ fontSize: 12, letterSpacing: -0.1, lineHeight: 1.15, textAlign: "center", fontWeight: isActive ? 700 : 500, color: isActive ? colors.sageDeep : colors.inkFaint }}>
                {t.label}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

/* ---------------------------------------------------------
   Home dashboard
--------------------------------------------------------- */
function TodayView({ setView, entries, alert, streak, hasLoggedToday, latestScore, notes, extras, shiftGate, offShift = false }) {
  const todaySymptoms = entries.length ? entries[entries.length - 1].symptoms : null;
  const activeSymptoms = todaySymptoms ? SYMPTOMS.filter((s) => todaySymptoms[s.key] > 0) : [];
  const canStart = hasLoggedToday || !shiftGate || shiftGate.allowed;

  return (
    <div>
      {alert && <CallActions alert={alert} />}

      <Card style={{ padding: 18, marginBottom: 16 }}>
        <div style={{ fontSize: 16, fontWeight: 700, color: colors.ink, marginBottom: 3 }}>Today's symptom check-in</div>
        <div style={{ fontSize: 13, color: colors.inkFaint, marginBottom: offShift ? 8 : 14 }}>
          {hasLoggedToday ? "Today's check-in has been recorded." : "Today's check-in hasn't been recorded yet."}
        </div>
        {offShift && (
          <p style={{ fontSize: 13, color: colors.inkSoft, margin: 0, lineHeight: 1.5 }}>
            You can see and fill in today's symptom check-in while you are on shift.{" "}
            {shiftGate?.next ? `Your next shift starts ${shiftGate.next.start.toLocaleString(undefined, { weekday: "short", hour: "numeric", minute: "2-digit" })}.` : "Call the office if you need it outside your shift."}
          </p>
        )}
        {!offShift && !canStart && (
          <p style={{ fontSize: 13, color: colors.rust, fontWeight: 600, margin: "0 0 12px", lineHeight: 1.5 }}>
            You can start a check-in while you're on shift.{" "}
            {shiftGate.next
              ? `Your next shift starts ${shiftGate.next.start.toLocaleString(undefined, { weekday: "short", hour: "numeric", minute: "2-digit" })}.`
              : "Call the office if you need to check in outside your shift."}
          </p>
        )}
        {!offShift && <button
          onClick={() => canStart && setView("checkin")}
          disabled={!canStart}
          style={{ padding: "12px 20px", borderRadius: 10, border: "none", background: canStart ? colors.sage : colors.hairline, color: canStart ? "#fff" : colors.inkFaint, fontSize: 14, fontWeight: 700, cursor: canStart ? "pointer" : "not-allowed" }}
        >
          {hasLoggedToday ? "View / edit check-in" : "Start check-in"}
        </button>}
      </Card>

      {extras}

    </div>
  );
}

/* ---------------------------------------------------------
   Symptom Check-in screen
--------------------------------------------------------- */
function CheckInView({ draft, setDraft, feelingDraft, setFeelingDraft, onsetDraft, setOnsetDraft, notesDraft, setNotesDraft, saveCheckIn, saving, existing, previous, nameFor, patientId, userId }) {
  const [attemptedSubmit, setAttemptedSubmit] = useState(false);
  const [versions, setVersions] = useState([]);
  const missingSymptoms = SYMPTOMS.filter((s) => draft[s.key] == null);

  // Everyone who saved today's check-in is kept, so nobody's ratings can be lost.
  useEffect(() => {
    setVersions([]);
    if (!existing || !patientId) return undefined;
    let cancelled = false;
    supabase.from("checkin_versions").select("id, symptoms, feeling, recorded_by, saved_at")
      .eq("patient_id", patientId).eq("entry_date", toISODate(new Date())).order("saved_at", { ascending: false })
      .then(({ data }) => { if (!cancelled && data) setVersions(data); });
    return () => { cancelled = true; };
  }, [existing, patientId]);

  const others = existing && existing.by && existing.by !== userId;
  const summarise = (symptoms) => {
    const active = SYMPTOMS.filter((s) => (symptoms?.[s.key] ?? 0) > 0);
    return active.length === 0 ? "All normal" : active.map((s) => `${s.label.split(" ")[0]} ${severityLabel(symptoms[s.key]).toLowerCase()}`).join(", ");
  };
  const allNormal = () => setDraft(Object.fromEntries(SYMPTOMS.map((s) => [s.key, 0])));
  const sameAsBefore = () => {
    if (!previous) return;
    setDraft({ ...blankDraft(), ...previous.symptoms });
    if (previous.feeling) setFeelingDraft(previous.feeling);
  };

  function handleSubmit() {
    if (missingSymptoms.length > 0) {
      setAttemptedSubmit(true);
      return;
    }
    saveCheckIn();
  }

  return (
    <Card style={{ padding: 22 }}>
      <h2 style={{ fontFamily: "Fraunces, serif", fontSize: 19, fontWeight: 600, color: colors.ink, margin: "0 0 4px" }}>
        Today's symptom check-in
      </h2>
      <p style={{ fontSize: 13, color: colors.inkFaint, margin: "0 0 16px" }}>
        How is the patient feeling today?
      </p>

      {others && (
        <div style={{ background: colors.goldTint, border: `1px solid ${colors.gold}`, borderRadius: 12, padding: "11px 14px", marginBottom: 14, fontSize: 13, color: colors.ink, lineHeight: 1.5 }}>
          <strong>{nameFor(patientId, existing.by) || "Someone on the care team"}</strong> already saved today's check-in{existing.at ? ` at ${new Date(existing.at).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}` : ""}. If you save, yours is added: today's score uses both check-ins. Their version is kept in the history below.
        </div>
      )}
      {existing && versions.length > 0 && (
        <details style={{ marginBottom: 14, fontSize: 13, color: colors.inkSoft }}>
          <summary style={{ cursor: "pointer", fontWeight: 700, color: colors.ink }}>Saves so far today ({versions.length})</summary>
          {versions.map((v, i) => (
            <div key={v.id} style={{ padding: "6px 0", borderBottom: i < versions.length - 1 ? `1px solid ${colors.hairline}` : "none" }}>
              <strong>{nameFor(patientId, v.recorded_by) || "Someone"}</strong>, {new Date(v.saved_at).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}{i === 0 ? " (current)" : ""}: {summarise(v.symptoms)}
            </div>
          ))}
        </details>
      )}

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 6 }}>
        <button type="button" onClick={allNormal} style={{ padding: "9px 14px", borderRadius: 10, border: `1px solid ${colors.sage}`, background: colors.sageTint, color: colors.sageDeep, fontSize: 13, fontWeight: 700, cursor: "pointer" }}>All normal</button>
        <button type="button" onClick={sameAsBefore} disabled={!previous} style={{ padding: "9px 14px", borderRadius: 10, border: `1px solid ${colors.hairline}`, background: "#fff", color: colors.inkSoft, fontSize: 13, fontWeight: 700, cursor: previous ? "pointer" : "default", opacity: previous ? 1 : 0.5 }}>Same as last check-in</button>
      </div>
      <p style={{ fontSize: 13, color: colors.inkFaint, margin: "0 0 16px" }}>Only use these if nothing has changed. You can still adjust any rating below.</p>

      <div style={{ display: "flex", gap: 8, marginBottom: 22 }}>
        {["Rough", "Low", "Okay", "Good", "Great"].map((label, i) => {
          const val = i + 1;
          const active = feelingDraft === val;
          return (
            <button key={label} onClick={() => setFeelingDraft(val)} style={{ flex: 1, padding: "12px 2px", borderRadius: 12, border: active ? `2px solid ${colors.sage}` : `1px solid ${colors.hairline}`, background: active ? colors.sageTint : "#fff", color: active ? colors.sageDeep : colors.inkSoft, fontSize: 13, fontWeight: 600, cursor: "pointer" }}>
              {label}
            </button>
          );
        })}
      </div>
      {attemptedSubmit && missingSymptoms.length > 0 && (
        <div style={{ background: colors.rustTint, color: colors.rust, padding: "12px 14px", borderRadius: 10, fontSize: 13, fontWeight: 600, marginBottom: 4, display: "flex", alignItems: "center", gap: 8 }}>
          <AlertTriangle size={15} />
          Please rate every symptom below before submitting — none can be skipped.
        </div>
      )}
      <div style={{ marginBottom: 6 }}>
        {SYMPTOMS.map((s) => (
          <SymptomRow
            key={s.key}
            symptom={s}
            value={draft[s.key]}
            onChange={(lvl) => setDraft((d) => ({ ...d, [s.key]: lvl }))}
            invalid={attemptedSubmit && draft[s.key] == null}
          />
        ))}
        <div style={{ padding: "16px 0" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
            <span style={{ fontSize: 15.5, fontWeight: 600, color: colors.ink }}>Time — When did it start?</span>
            <span style={{ fontSize: 12.5, fontWeight: 700, letterSpacing: 0.4, color: colors.sageDeep, background: colors.sageTint, padding: "2px 7px", borderRadius: 999 }}>
              BE FAST
            </span>
          </div>
          <p style={{ fontSize: 13, color: colors.inkFaint, margin: "0 0 8px" }}>
            If you're reporting a new or worsening symptom above, note when it started — this matters for treatment.
          </p>
          <input
            type="text"
            value={onsetDraft}
            onChange={(e) => setOnsetDraft(e.target.value)}
            placeholder="e.g., this morning around 8am"
            style={{ width: "100%", padding: 12, borderRadius: 10, border: `1px solid ${colors.hairline}`, fontSize: 13.5, boxSizing: "border-box" }}
          />
        </div>
      </div>
      <div style={{ marginTop: 10 }}>
        <label style={{ fontSize: 13.5, fontWeight: 600, color: colors.ink, display: "block", marginBottom: 4 }}>Additional notes</label>
        <p style={{ fontSize: 13, color: colors.inkFaint, margin: "0 0 8px" }}>Anything else you would like to record?</p>
        <textarea
          value={notesDraft}
          onChange={(e) => setNotesDraft(e.target.value)}
          rows={3}
          placeholder="Optional notes for your care team..."
          style={{ width: "100%", padding: 12, borderRadius: 10, border: `1px solid ${colors.hairline}`, fontSize: 13.5, fontFamily: "inherit", boxSizing: "border-box", resize: "vertical" }}
        />
      </div>
      <button onClick={handleSubmit} disabled={saving} style={{ width: "100%", marginTop: 18, padding: "15px 0", borderRadius: 12, border: "none", background: colors.sage, color: "#fff", fontSize: 15.5, fontWeight: 700, cursor: saving ? "default" : "pointer", opacity: saving ? 0.7 : 1 }}>
        {saving ? "Saving to your account..." : "Submit check-in"}
      </button>
    </Card>
  );
}

/* ---------------------------------------------------------
   Check-in Results / Change Detection screen
--------------------------------------------------------- */
function ResultsView({ entries, anomalies, alert, aiInsights, aiLoading, setView, startEditToday }) {
  const today = entries.length ? entries[entries.length - 1] : null;
  return (
    <div>
      <Card style={{ padding: 22, marginBottom: 16 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
          <CheckCircle2 size={20} color={colors.sage} />
          <h2 style={{ fontFamily: "Fraunces, serif", fontSize: 19, fontWeight: 600, color: colors.ink, margin: 0 }}>
            The check-in has been recorded.
          </h2>
        </div>
        <p style={{ fontSize: 13.5, color: colors.inkFaint, margin: "4px 0 16px" }}>Today's Summary</p>
        {today && SYMPTOMS.map((s) => (
          <div key={s.key} style={{ display: "flex", justifyContent: "space-between", padding: "8px 0", borderBottom: `1px solid ${colors.hairline}` }}>
            <span style={{ fontSize: 13.5, color: colors.ink }}>{s.label}</span>
            <span style={{ fontSize: 13, fontWeight: 700, color: severityColor(today.symptoms[s.key]) }}>
              {severityLabel(today.symptoms[s.key])}
            </span>
          </div>
        ))}
        {today?.onset && (
          <div style={{ marginTop: 14, display: "flex", gap: 8, alignItems: "baseline" }}>
            <span style={{ fontSize: 13, fontWeight: 700, color: colors.rust }}>T · Onset:</span>
            <span style={{ fontSize: 13, color: colors.ink }}>{today.onset}</span>
          </div>
        )}
        {today?.notes && (
          <div style={{ marginTop: 10, fontSize: 13, color: colors.inkSoft, fontStyle: "italic" }}>
            "{today.notes}"
          </div>
        )}
      </Card>

      {alert && <CallActions alert={alert} />}

      {anomalies.length > 0 && (
        <Card style={{ padding: 20, marginBottom: 16, background: colors.goldTint }}>
          <div style={{ fontSize: 14.5, fontWeight: 700, color: colors.ink, marginBottom: 6 }}>
            ⚠️ Significant Change Detected
          </div>
          <p style={{ fontSize: 13.5, color: colors.ink, margin: "0 0 14px", lineHeight: 1.5 }}>
            {anomalies[0].message}
          </p>
          <div style={{ borderTop: `1px solid rgba(32,38,31,0.12)`, paddingTop: 12 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 6 }}>
              <Sparkles size={14} color={colors.sageDeep} />
              <span style={{ fontSize: 13, fontWeight: 700, color: colors.sageDeep, textTransform: "uppercase", letterSpacing: 0.4 }}>
                Why Strovia flagged this
              </span>
            </div>
            <p style={{ fontSize: 13.5, color: colors.ink, margin: 0, lineHeight: 1.5 }}>
              {aiInsights?.explanation
                ? aiInsights.explanation
                : aiLoading
                ? "Analyzing the check-in..."
                : `Strovia detected a significant change in the severity of the reported ${anomalies[0].label.toLowerCase()} symptom.`}
            </p>
          </div>
        </Card>
      )}

      <div style={{ display: "flex", gap: 10 }}>
        <button onClick={() => setView("today")} style={{ flex: 1, padding: "13px 0", borderRadius: 12, border: "none", background: colors.sage, color: "#fff", fontSize: 14.5, fontWeight: 700, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}>
          Back to Today <ChevronRight size={16} />
        </button>
        <button onClick={startEditToday} style={{ padding: "13px 16px", borderRadius: 12, border: `1px solid ${colors.hairline}`, background: "#fff", color: colors.inkSoft, fontSize: 14, fontWeight: 600, cursor: "pointer", display: "flex", alignItems: "center", gap: 6 }}>
          <Pencil size={14} /> Edit
        </button>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------
   Severe symptom / safety screen
--------------------------------------------------------- */
function SafetyView({ setView }) {
  return (
    <Card style={{ padding: 24 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
        <AlertTriangle size={26} color={colors.rust} />
        <h2 style={{ fontFamily: "Fraunces, serif", fontSize: 20, fontWeight: 600, color: colors.rust, margin: 0 }}>
          ⚠️ Important
        </h2>
      </div>
      <p style={{ fontSize: 14.5, fontWeight: 600, color: colors.ink, margin: "0 0 14px" }}>
        A severe symptom was recorded.
      </p>
      <p style={{ fontSize: 13.5, color: colors.inkSoft, lineHeight: 1.6, margin: "0 0 12px" }}>
        Think <strong>B.E. F.A.S.T.</strong> — the American Stroke Association's warning signs.
        If any of these are new or sudden, call 911 immediately:
      </p>
      <div style={{ background: colors.goldTint, borderRadius: 10, padding: "6px 14px", marginBottom: 20 }}>
        {[
          ["B", "Balance", "New balance problems or dizziness?"],
          ["E", "Eyes", "New vision changes?"],
          ["F", "Face", "New facial drooping?"],
          ["A", "Arms", "New arm weakness or numbness?"],
          ["S", "Speech", "New speech difficulty?"],
          ["T", "Time", "Note when it started, then call 911."],
        ].map(([letter, word, text]) => (
          <div key={letter} style={{ display: "flex", gap: 10, alignItems: "baseline", padding: "7px 0", borderBottom: letter !== "T" ? `1px solid rgba(32,38,31,0.08)` : "none" }}>
            <strong style={{ color: colors.rust, fontSize: 15, width: 16, flexShrink: 0 }}>{letter}</strong>
            <span style={{ fontSize: 13, color: colors.ink }}>
              <strong>{word}</strong> — {text}
            </span>
          </div>
        ))}
      </div>
      <a
        href="tel:911"
        style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8, width: "100%", padding: "15px 0", borderRadius: 12, background: colors.rust, color: "#fff", fontSize: 15.5, fontWeight: 700, textDecoration: "none", marginBottom: 10, boxSizing: "border-box" }}
      >
        <PhoneCall size={18} /> Call 911
      </a>
      <a
        href={telHref(OFFICE_PHONE)}
        style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8, width: "100%", padding: "13px 0", borderRadius: 12, background: colors.goldTint, border: `1px solid ${colors.gold}`, color: colors.ink, fontSize: 14, fontWeight: 700, textDecoration: "none", marginBottom: 10, boxSizing: "border-box" }}
      >
        <Phone size={16} /> Then let the office know · {OFFICE_PHONE}
      </a>
      <button
        onClick={() => setView("results")}
        style={{ width: "100%", padding: "13px 0", borderRadius: 12, border: `1px solid ${colors.hairline}`, background: "#fff", color: colors.inkSoft, fontSize: 14, fontWeight: 600, cursor: "pointer" }}
      >
        Review Symptoms
      </button>
      <p style={{ fontSize: 12.5, color: colors.inkFaint, marginTop: 16, lineHeight: 1.5 }}>
        Strovia does not diagnose medical conditions. It flags potentially concerning changes and
        directs you toward appropriate care.
      </p>
    </Card>
  );
}

/* ---------------------------------------------------------
   Recovery Progress screen
--------------------------------------------------------- */
// The chart's dot: invisible on an ordinary day, a small rust marker on a day an incident was reported — so the
// line tells the story of *why* the score moved, not just that it did.
function ChartEventDot(props) {
  const { cx, cy, payload, index } = props;
  if (payload.incident) return <circle key={`dot-${index}`} cx={cx} cy={cy} r={5} fill={colors.rust} stroke="#fff" strokeWidth={2} />;
  if (payload.actionTaken) return <circle key={`dot-${index}`} cx={cx} cy={cy} r={5} fill={colors.gold} stroke="#fff" strokeWidth={2} />;
  return <g key={`dot-${index}`} />;
}

function ChartTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  const p = payload[0].payload;
  return (
    <div style={{ background: "#fff", border: `1px solid ${colors.hairline}`, borderRadius: 10, padding: "9px 12px", fontSize: 13, boxShadow: "0 4px 12px rgba(32,38,31,0.1)" }}>
      <div style={{ fontWeight: 700, color: colors.ink, marginBottom: 2 }}>{label}</div>
      <div style={{ color: colors.sageDeep }}>Score: {p.score}</div>
      {p.incident && (
        <div style={{ color: colors.rust, fontWeight: 600, marginTop: 4 }}>
          Incident: {p.incident.kind}{p.incident.injury ? " (with injury)" : ""}
        </div>
      )}
      {p.actionTaken && <div style={{ color: "#7A5A12", fontWeight: 600, marginTop: 4 }}>Action recorded for severe symptoms</div>}
    </div>
  );
}

function ProgressView({ entries, trends, latestScore, streak, profile, setView, incidents = [], actions = [], scoreDays = [], carePlan = null, infoOf, wide = false }) {
  const milestones = computeMilestones(entries, streak, profile);

  const improving = SYMPTOMS.filter((s) => trends[s.key]?.direction === "improving");
  const stable = SYMPTOMS.filter((s) => !trends[s.key] || trends[s.key]?.direction === "stable");
  const needsAttention = SYMPTOMS.filter((s) => trends[s.key]?.direction === "worsening");

  return (
    <div>
      <div style={wide ? { display: "grid", gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)", gap: 20, alignItems: "start" } : undefined}>
        <RecoveryCard days={scoreDays} latestScore={latestScore} incidents={incidents} actions={actions} symptoms={SYMPTOMS} infoOf={infoOf} />
        {carePlan && <CarePlanCard care={carePlan} />}
      </div>

      <Card style={{ padding: 20, marginBottom: 16 }}>
        <h3 style={{ fontFamily: "Fraunces, serif", fontSize: 16.5, fontWeight: 600, color: colors.ink, margin: "0 0 12px" }}>Recovery highlights</h3>
        {[
          { label: "Improving", list: improving, color: colors.sage },
          { label: "Stable", list: stable, color: colors.inkFaint },
          { label: "Needs attention", list: needsAttention, color: colors.rust },
        ].map((group) => (
          <div key={group.label} style={{ marginBottom: 12 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: group.color, textTransform: "uppercase", letterSpacing: 0.4, marginBottom: 6 }}>
              {group.label}
            </div>
            {group.list.length === 0 ? (
              <div style={{ fontSize: 13, color: colors.inkFaint }}>None</div>
            ) : (
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                {group.list.map((s) => (
                  <span key={s.key} style={{ fontSize: 13, color: colors.ink, background: colors.cardMuted, padding: "5px 10px", borderRadius: 999 }}>
                    {s.label}
                  </span>
                ))}
              </div>
            )}
          </div>
        ))}
      </Card>

      <Card style={{ padding: 20, marginBottom: 16 }}>
        <h3 style={{ fontFamily: "Fraunces, serif", fontSize: 16.5, fontWeight: 600, color: colors.ink, margin: "0 0 12px" }}>Milestones</h3>
        {milestones.length === 0 ? (
          <p style={{ fontSize: 13, color: colors.inkFaint, margin: 0 }}>No milestones yet — keep checking in.</p>
        ) : (
          milestones.map((m, i) => (
            <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 0" }}>
              <CheckCircle2 size={15} color={colors.sage} />
              <span style={{ fontSize: 13.5, color: colors.ink }}>{m}</span>
            </div>
          ))
        )}
      </Card>

      <Card style={{ padding: 20 }}>
        <h3 style={{ fontFamily: "Fraunces, serif", fontSize: 16.5, fontWeight: 600, color: colors.ink, margin: "0 0 4px" }}>Symptom trends</h3>
        <p style={{ fontSize: 13, color: colors.inkFaint, margin: "0 0 10px" }}>Last 13+ days, most recent on the right</p>
        {SYMPTOMS.map((s) => {
          const t = trends[s.key];
          const values = entries.map((e) => e.symptoms[s.key]);
          return (
            <div key={s.key} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 0", borderBottom: `1px solid ${colors.hairline}` }}>
              <div style={{ display: "flex", alignItems: "center", gap: 7, minWidth: 100, flexWrap: "wrap" }}>
                <span style={{ fontSize: 13.5, fontWeight: 600, color: colors.ink }}>{s.label}</span>
                {s.core && <span style={{ fontSize: 12.5, fontWeight: 700, color: colors.sageDeep, background: colors.sageTint, padding: "1.5px 6px", borderRadius: 999 }}>BE FAST</span>}
              </div>
              <MiniBars values={values} />
              <div style={{ display: "flex", alignItems: "center", gap: 4, minWidth: 70, flexShrink: 0, justifyContent: "flex-end" }}>
                <TrendIcon direction={t?.direction || "stable"} />
                <span style={{ fontSize: 13, fontWeight: 600, color: t?.direction === "improving" ? colors.sage : t?.direction === "worsening" ? colors.rust : colors.inkFaint, textTransform: "capitalize" }}>
                  {t?.direction || "stable"}
                </span>
              </div>
            </div>
          );
        })}
      </Card>

      <button
        onClick={() => setView("recovery")}
        style={{ display: "flex", alignItems: "center", justifyContent: "space-between", width: "100%", padding: "14px 16px", borderRadius: 14, border: "none", background: colors.sageTint, marginTop: 16, cursor: "pointer", textAlign: "left" }}
      >
        <span>
          <span style={{ display: "block", fontSize: 14, fontWeight: 700, color: colors.sageDeep }}>Recovery overview</span>
          <span style={{ display: "block", fontSize: 13, color: colors.inkSoft, marginTop: 1 }}>Recovery level, milestones and progress notes</span>
        </span>
        <ChevronRight size={16} color={colors.sageDeep} />
      </button>
    </div>
  );
}

/* ---------------------------------------------------------
   Recovery Overview screen
--------------------------------------------------------- */
function RecoveryView({ setView, entries, trends, latestScore, profile, badges, aiInsights, aiLoading }) {
  const fallback = recoveryLevelFallback(latestScore);
  const level = aiInsights?.recovery_level || fallback.label;
  const emoji = aiInsights?.recovery_level
    ? { Good: "🟢", Mild: "🟡", Moderate: "🟠", Severe: "🔴" }[aiInsights.recovery_level] || fallback.emoji
    : fallback.emoji;
  const trend = aiInsights?.trend || (scoreDelta(entries) >= 0 ? "Improving" : "Declining");
  const improvingCount = SYMPTOMS.filter((s) => trends[s.key]?.direction === "improving").length;
  const worseningCount = SYMPTOMS.filter((s) => trends[s.key]?.direction === "worsening").length;
  const days = daysSince(profile.strokeDate);

  const progressField = (label, value) => (
    <div style={{ marginBottom: 14 }}>
      <div style={{ fontSize: 13, fontWeight: 700, color: colors.inkSoft, marginBottom: 4 }}>{label}</div>
      <p style={{ fontSize: 13.5, color: colors.ink, margin: 0, lineHeight: 1.5 }}>
        {value || (aiLoading ? "Analyzing..." : "Not enough data yet — check in a few more days to see this insight.")}
      </p>
    </div>
  );

  return (
    <div>
      <button onClick={() => setView("progress")} style={{ display: "flex", alignItems: "center", gap: 6, border: "none", background: "none", color: colors.sageDeep, fontSize: 13, fontWeight: 600, cursor: "pointer", padding: 0, marginBottom: 14 }}>
        <ArrowLeft size={15} /> Back to Progress
      </button>

      <Card style={{ padding: 20, marginBottom: 16 }}>
        <h2 style={{ fontFamily: "Fraunces, serif", fontSize: 19, fontWeight: 600, color: colors.ink, margin: "0 0 14px" }}>Recovery Overview</h2>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 0", borderBottom: `1px solid ${colors.hairline}` }}>
          <span style={{ fontSize: 13, color: colors.inkFaint }}>Current recovery level</span>
          <span style={{ fontSize: 14, fontWeight: 700, color: colors.ink }}>{emoji} {level}</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 0", borderBottom: `1px solid ${colors.hairline}` }}>
          <span style={{ fontSize: 13, color: colors.inkFaint }}>Recovery score</span>
          <span style={{ fontSize: 14, fontWeight: 700, color: colors.ink }}>{latestScore ?? "—"}</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 0", borderBottom: `1px solid ${colors.hairline}` }}>
          <span style={{ fontSize: 13, color: colors.inkFaint }}>Days since stroke</span>
          <span style={{ fontSize: 14, fontWeight: 700, color: colors.ink }}>{days ?? "Not set"}</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 0", borderBottom: `1px solid ${colors.hairline}` }}>
          <span style={{ fontSize: 13, color: colors.inkFaint }}>Symptoms improving</span>
          <span style={{ fontSize: 14, fontWeight: 700, color: colors.sage }}>{improvingCount}</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 0", borderBottom: `1px solid ${colors.hairline}` }}>
          <span style={{ fontSize: 13, color: colors.inkFaint }}>Symptoms worsening</span>
          <span style={{ fontSize: 14, fontWeight: 700, color: colors.rust }}>{worseningCount}</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 0" }}>
          <span style={{ fontSize: 13, color: colors.inkFaint }}>Recovery trend</span>
          <span style={{ fontSize: 14, fontWeight: 700, color: colors.ink }}>{trend}</span>
        </div>
      </Card>

      <Card style={{ padding: 20, marginBottom: 16 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 14 }}>
          <Sparkles size={16} color={colors.sageDeep} />
          <h3 style={{ fontFamily: "Fraunces, serif", fontSize: 16.5, fontWeight: 600, color: colors.ink, margin: 0 }}>AI Progress Notes</h3>
        </div>
        {progressField("Mobility progress", aiInsights?.mobility_progress)}
        {progressField("Speech progress", aiInsights?.speech_progress)}
        {progressField("Cognitive progress", aiInsights?.cognitive_progress)}
        {progressField("ADL / independence progress", aiInsights?.adl_progress)}
      </Card>

      {profile.recoveryGoals?.length > 0 && (
        <Card style={{ padding: 20, marginBottom: 16 }}>
          <h3 style={{ fontFamily: "Fraunces, serif", fontSize: 16.5, fontWeight: 600, color: colors.ink, margin: "0 0 10px" }}>Recovery Goals</h3>
          {profile.recoveryGoals.map((g, i) => (
            <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, padding: "5px 0" }}>
              <ListChecks size={14} color={colors.sageDeep} />
              <span style={{ fontSize: 13.5, color: colors.ink }}>{g}</span>
            </div>
          ))}
        </Card>
      )}

      <Card style={{ padding: 20 }}>
        <h3 style={{ fontFamily: "Fraunces, serif", fontSize: 16.5, fontWeight: 600, color: colors.ink, margin: "0 0 10px" }}>Recent Milestones</h3>
        {badges.length === 0 ? (
          <p style={{ fontSize: 13, color: colors.inkFaint, margin: 0 }}>None yet.</p>
        ) : (
          badges.map((b, i) => (
            <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 0" }}>
              <b.icon size={15} color={b.tone === "gold" ? colors.gold : colors.sage} />
              <span style={{ fontSize: 13.5, color: colors.ink }}>{b.label}</span>
            </div>
          ))
        )}
      </Card>
    </div>
  );
}

/* ---------------------------------------------------------
   Profile screen: the signed-in person's own account
--------------------------------------------------------- */
const ROLE_LABEL = { admin: "Administrator", caregiver: "Caregiver", relative: "Family proxy" };

function InfoRows({ rows }) {
  return rows.filter(([, v]) => v).map(([label, value]) => (
    <div key={label} style={{ display: "flex", justifyContent: "space-between", gap: 14, padding: "10px 0", borderBottom: `1px solid ${colors.hairline}` }}>
      <span style={{ fontSize: 13, color: colors.inkFaint, flexShrink: 0 }}>{label}</span>
      <span style={{ fontSize: 13.5, fontWeight: 600, color: colors.ink, textAlign: "right" }}>{value}</span>
    </div>
  ));
}

function ProfileView({ member, userEmail, userId, onSignOut, onMemberUpdated, training, onOpenTraining }) {
  const [size, setSize] = useState(getTextSize());
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({});
  const [editBusy, setEditBusy] = useState(false);
  const [editError, setEditError] = useState(null);
  const [request, setRequest] = useState(null); // the latest change request this person made, if any
  const [emailBusy, setEmailBusy] = useState(false);
  const [changingPassword, setChangingPassword] = useState(false);
  const [newPw, setNewPw] = useState("");
  const [confirmPw, setConfirmPw] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [pwError, setPwError] = useState(null);
  const [pwBusy, setPwBusy] = useState(false);
  const [pwDone, setPwDone] = useState(false);
  const [devices, setDevices] = useState(null); // null = not loaded yet (administrators only)
  const [deviceBusy, setDeviceBusy] = useState(null); // a device id, "all", or null
  const [deviceMessage, setDeviceMessage] = useState(null);
  const [confirmForgetAll, setConfirmForgetAll] = useState(false);
  const myDeviceSuffix = (() => { try { const t = localStorage.getItem("strovia-admin-device"); return t ? t.slice(-6) : null; } catch { return null; } })();

  useEffect(() => {
    if (member.role !== "admin") return;
    let cancelled = false;
    supabase.rpc("list_my_trusted_devices").then(({ data }) => { if (!cancelled) setDevices(data || []); });
    return () => { cancelled = true; };
  }, [member.role]);

  async function forgetDevice(id, isThisDevice) {
    setDeviceBusy(id);
    setDeviceMessage(null);
    const { error } = await supabase.rpc("forget_my_trusted_device", { p_id: id });
    setDeviceBusy(null);
    if (error) { setDeviceMessage({ type: "error", text: "Couldn't remove that device. Please try again." }); return; }
    if (isThisDevice) { try { localStorage.removeItem("strovia-admin-device"); } catch { /* not critical */ } }
    setDevices((d) => d.filter((x) => x.id !== id));
    setDeviceMessage({ type: "ok", text: "That device will need a sign-in code again next time." });
  }

  async function forgetAllDevices() {
    setDeviceBusy("all");
    setDeviceMessage(null);
    const { error } = await supabase.rpc("forget_all_my_trusted_devices");
    setDeviceBusy(null);
    setConfirmForgetAll(false);
    if (error) { setDeviceMessage({ type: "error", text: "Couldn't remove your devices. Please try again." }); return; }
    try { localStorage.removeItem("strovia-admin-device"); } catch { /* not critical */ }
    setDevices([]);
    setDeviceMessage({ type: "ok", text: "All devices forgotten. Every sign-in, including this one, will need a code again." });
  }

  async function submitPasswordChange(e) {
    e.preventDefault();
    setPwError(null);
    if (newPw.length < 8) { setPwError("Password must be at least 8 characters."); return; }
    if (newPw !== confirmPw) { setPwError("Passwords don't match."); return; }
    setPwBusy(true);
    const { error } = await supabase.auth.updateUser({ password: newPw });
    setPwBusy(false);
    if (error) setPwError(error.message);
    else {
      setPwDone(true);
      setNewPw("");
      setConfirmPw("");
    }
  }

  const accountName = [member.first_name, member.last_name].filter(Boolean).join(" ") || userEmail;

  async function loadRequest() {
    if (member.role === "admin") return;
    const { data } = await supabase.from("profile_change_requests").select("*").eq("user_id", userId).order("created_at", { ascending: false }).limit(1);
    const r = data && data[0] ? data[0] : null;
    setRequest(r);
    if (r && r.status === "approved" && !r.seen_at) {
      // An administrator approved a change: bring this screen up to date with what is now on file.
      const { data: fresh } = await supabase.from("staff_accounts").select("first_name, last_name, job_title, organisation, phone, birthday_month, birthday_day").eq("user_id", userId).maybeSingle();
      if (fresh) onMemberUpdated(fresh);
    }
  }
  useEffect(() => { loadRequest(); }, [userId]);

  // Name, job title, organisation and birthday can be changed once on your own (administrators are not limited). After that,
  // a change is a request for an administrator. A phone number, and a first-time birthday, are always free.
  const locked = member.role !== "admin" && !!member.details_edited_at;
  const lockedFieldsChanged = () => (form.first || "").trim() !== (member.first_name || "") || (form.last || "").trim() !== (member.last_name || "")
    || (form.jobTitle || "").trim() !== (member.job_title || "") || (form.organisation || "").trim() !== (member.organisation || "")
    || (!!member.birthday_month && (Number(form.bMonth) || null) !== member.birthday_month || (Number(form.bDay) || null) !== member.birthday_day && !!member.birthday_month);
  const changedNow = editing && lockedFieldsChanged();

  function startEditing() {
    setForm({
      first: member.first_name || "", last: member.last_name || "", jobTitle: member.job_title || "",
      phone: member.phone || "", organisation: member.organisation || "",
      bMonth: member.birthday_month || "", bDay: member.birthday_day || "",
    });
    setEditError(null);
    setEditing(true);
  }

  async function saveDetails(e) {
    e.preventDefault();
    setEditError(null);
    const hasBirthday = form.bMonth && form.bDay;
    const changed = lockedFieldsChanged();
    const phoneNow = form.phone.trim() || null;

    if (locked && changed) {
      // The one change is used up: the phone number still saves straight away, the rest goes to an administrator.
      setEditBusy(true);
      if (phoneNow !== (member.phone || null)) {
        const p = await supabase.rpc("update_my_details", { p_first: member.first_name || "", p_last: member.last_name || "", p_job_title: member.job_title || "", p_phone: form.phone, p_organisation: member.organisation || "" });
        if (p.error) { setEditBusy(false); setEditError("Your phone number couldn't be saved. Please try again."); return; }
        onMemberUpdated({ phone: phoneNow });
      }
      const { error: reqError } = await supabase.rpc("request_profile_change", {
        p_first: form.first, p_last: form.last, p_job_title: form.jobTitle, p_organisation: form.organisation,
        p_month: hasBirthday ? Number(form.bMonth) : null, p_day: hasBirthday ? Number(form.bDay) : null,
      });
      setEditBusy(false);
      if (reqError) { setEditError(/different/i.test(reqError.message) ? "Nothing is different from what is on file." : "Your request couldn't be sent. Check the details and try again."); return; }
      await loadRequest();
      setEditing(false);
      return;
    }
    if (!locked && changed && member.role !== "admin" && !window.confirm("You can change your name, job title, organisation and birthday only once on your own. After this, changes need your administrator's approval. Save now?")) return;

    setEditBusy(true);
    const { error } = await supabase.rpc("update_my_details", {
      p_first: form.first, p_last: form.last, p_job_title: form.jobTitle, p_phone: form.phone, p_organisation: form.organisation,
    });
    if (error) { setEditBusy(false); setEditError("Your details couldn't be saved. Please try again."); return; }
    if ((form.bMonth || "") !== (member.birthday_month || "") || (form.bDay || "") !== (member.birthday_day || "")) {
      const b = await supabase.rpc("set_my_birthday", { p_month: hasBirthday ? Number(form.bMonth) : null, p_day: hasBirthday ? Number(form.bDay) : null });
      if (b.error) { setEditBusy(false); setEditError("Your birthday couldn't be saved. Choose both a month and a day, or clear both."); return; }
    }
    setEditBusy(false);
    onMemberUpdated({
      first_name: form.first.trim() || null, last_name: form.last.trim() || null, job_title: form.jobTitle.trim() || null,
      phone: form.phone.trim() || null, organisation: form.organisation.trim(),
      birthday_month: hasBirthday ? Number(form.bMonth) : null, birthday_day: hasBirthday ? Number(form.bDay) : null,
      ...(member.role !== "admin" && changed ? { details_edited_at: new Date().toISOString() } : {}),
    });
    setEditing(false);
  }

  const detailInput = { width: "100%", padding: "10px 12px", borderRadius: 10, border: `1px solid ${colors.hairline}`, fontSize: 14, boxSizing: "border-box" };
  const detailLabel = { fontSize: 13, fontWeight: 600, color: colors.inkSoft, display: "block", marginBottom: 5 };

  return (
    <div>
      <Card style={{ padding: 22, marginBottom: 16 }}>
        <ProfilePhoto userId={userId} name={accountName} avatarPath={member.avatar_path || null} onChanged={(p) => onMemberUpdated({ avatar_path: p })} />
        <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 14 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontFamily: "Fraunces, serif", fontSize: 19, fontWeight: 600, color: colors.ink }}>{accountName}</div>
            <span style={{ display: "inline-block", marginTop: 3, fontSize: 12.5, fontWeight: 700, color: colors.sageDeep, background: colors.sageTint, padding: "2px 10px", borderRadius: 999 }}>
              {ROLE_LABEL[member.role] || member.role}
            </span>
          </div>
          {!editing && (
            <button onClick={startEditing} style={{ border: `1px solid ${colors.hairline}`, background: "#fff", borderRadius: 9, padding: "8px 13px", fontSize: 13, fontWeight: 600, color: colors.inkSoft, cursor: "pointer", display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
              <Pencil size={13} /> Edit
            </button>
          )}
        </div>

        {request && (request.status === "pending" || !request.seen_at) && <ProfileRequestNotice request={request} onDismiss={() => setRequest(null)} />}

        {editing ? (
          <form onSubmit={saveDetails}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 12 }}>
              <div>
                <label style={detailLabel}>First name</label>
                <input required value={form.first} onChange={(e) => setForm((f) => ({ ...f, first: e.target.value }))} style={detailInput} />
              </div>
              <div>
                <label style={detailLabel}>Last name</label>
                <input value={form.last} onChange={(e) => setForm((f) => ({ ...f, last: e.target.value }))} style={detailInput} />
              </div>
            </div>
            <label style={detailLabel}>Job title</label>
            <input value={form.jobTitle} onChange={(e) => setForm((f) => ({ ...f, jobTitle: e.target.value }))} placeholder="e.g. Administrator" style={{ ...detailInput, marginBottom: 12 }} />
            <label style={detailLabel}>Organisation</label>
            <input value={form.organisation} onChange={(e) => setForm((f) => ({ ...f, organisation: e.target.value }))} style={{ ...detailInput, marginBottom: 12 }} />
            <label style={detailLabel}>Phone</label>
            <input type="tel" value={form.phone} onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))} style={{ ...detailInput, marginBottom: 12 }} />
            {member.role !== "relative" && (
              <div style={{ marginBottom: 6 }}>
                <BirthdayFields required month={form.bMonth} day={form.bDay} onChange={(m, d) => setForm((f) => ({ ...f, bMonth: m, bDay: d }))} selectStyle={detailInput} labelStyle={detailLabel} />
              </div>
            )}
            {member.role !== "admin" && (
              <p style={{ fontSize: 13, color: locked ? "#6B4D0E" : colors.inkSoft, background: locked ? colors.goldTint : colors.bg, borderRadius: 10, padding: "8px 10px", margin: "0 0 10px", lineHeight: 1.45 }}>
                {locked
                  ? "You have already used your one change. Changing your name, job title, organisation or birthday now sends a request to your administrator. Your phone number changes straight away."
                  : "You can change your name, job title, organisation or birthday once on your own. After that, changes need your administrator's approval. Your phone number can always be changed."}
              </p>
            )}
            <p style={{ fontSize: 13, color: colors.inkFaint, margin: "0 0 14px", lineHeight: 1.4 }}>Your Company ID, email and role can't be changed here.</p>
            <div style={{ display: "flex", gap: 10 }}>
              <button type="submit" disabled={editBusy} style={{ flex: 1, padding: "12px 0", borderRadius: 10, border: "none", background: colors.sage, color: "#fff", fontSize: 14, fontWeight: 700, cursor: editBusy ? "default" : "pointer", opacity: editBusy ? 0.7 : 1 }}>
                {editBusy ? "Saving..." : locked && changedNow ? "Send request" : "Save"}
              </button>
              <button type="button" onClick={() => setEditing(false)} style={{ padding: "12px 16px", borderRadius: 10, border: `1px solid ${colors.hairline}`, background: "#fff", color: colors.inkSoft, fontSize: 14, fontWeight: 600, cursor: "pointer" }}>Cancel</button>
            </div>
            {editError && <p style={{ color: colors.rust, fontSize: 13, margin: "10px 0 0" }}>{editError}</p>}
          </form>
        ) : (
          <InfoRows rows={[
            ["Email", userEmail],
            ["Company ID", member.company_id],
            ["Organisation", member.organisation],
            ["Job title", member.job_title],
            ["Phone", member.phone],
            ...(member.role !== "relative" ? [["Birthday", birthdayText(member.birthday_month, member.birthday_day)]] : []),
          ]} />
        )}
      </Card>

      {(member.role === "admin" || member.role === "caregiver") && (
        <EmailNoticeSwitch on={member.email_message_notices !== false} busy={emailBusy} onChange={async (on) => {
          setEmailBusy(true);
          const { error } = await supabase.rpc("set_my_email_notices", { p_on: on });
          setEmailBusy(false);
          if (!error) onMemberUpdated({ email_message_notices: on });
        }} />
      )}

      <Card style={{ padding: 20, marginBottom: 16 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: colors.inkFaint, textTransform: "uppercase", letterSpacing: 0.4, marginBottom: 10 }}>
          Text size
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {SIZES.map((s) => (
            <button key={s.key} onClick={() => { setTextSize(s.key); setSize(s.key); }} aria-pressed={size === s.key}
              style={{ flex: "1 1 90px", padding: "10px 6px", borderRadius: 10, border: `1px solid ${size === s.key ? colors.sage : colors.hairline}`, background: size === s.key ? colors.sageTint : "#fff", color: size === s.key ? colors.sageDeep : colors.inkSoft, fontSize: 13.5 * s.zoom, fontWeight: 700, cursor: "pointer" }}>
              {s.label}
            </button>
          ))}
        </div>
        <p style={{ fontSize: 13, color: colors.inkFaint, margin: "8px 0 0" }}>Makes everything larger on this phone or computer.</p>
      </Card>

      {member.role === "admin" && (
        <Card style={{ padding: 20, marginBottom: 16 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
            <MonitorSmartphone size={15} color={colors.inkSoft} />
            <div style={{ fontSize: 13, fontWeight: 700, color: colors.inkFaint, textTransform: "uppercase", letterSpacing: 0.4 }}>Remembered devices</div>
          </div>
          <p style={{ fontSize: 13, color: colors.inkFaint, margin: "0 0 12px", lineHeight: 1.5 }}>
            Devices you told Strovia to remember for 30 days, so signing in doesn't ask for an emailed code. Forget a device if it's lost, shared, or no longer yours.
          </p>
          {deviceMessage && (
            <p style={{ fontSize: 13, margin: "0 0 10px", fontWeight: 600, color: deviceMessage.type === "error" ? colors.rust : colors.sageDeep }}>{deviceMessage.text}</p>
          )}
          {devices === null ? (
            <p style={{ fontSize: 13, color: colors.inkFaint, margin: 0 }}>Loading...</p>
          ) : devices.length === 0 ? (
            <p style={{ fontSize: 13, color: colors.inkFaint, margin: 0 }}>No devices are remembered. Every sign-in needs a code.</p>
          ) : (
            <>
              {devices.map((d) => {
                const isThis = myDeviceSuffix && d.token_suffix === myDeviceSuffix;
                return (
                  <div key={d.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, padding: "9px 0", borderTop: `1px solid ${colors.hairline}` }}>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontSize: 13.5, fontWeight: 600, color: colors.ink }}>
                        Device ending in {d.token_suffix}{isThis && <span style={{ marginLeft: 8, fontSize: 12.5, fontWeight: 700, color: colors.sageDeep, background: colors.sageTint, padding: "1.5px 8px", borderRadius: 999 }}>This device</span>}
                      </div>
                      <div style={{ fontSize: 12.5, color: colors.inkFaint, marginTop: 2 }}>
                        Remembered {new Date(d.created_at).toLocaleDateString()} · Last used {new Date(d.last_used_at).toLocaleDateString()} · Expires {new Date(d.expires_at).toLocaleDateString()}
                      </div>
                    </div>
                    <button onClick={() => forgetDevice(d.id, isThis)} disabled={deviceBusy === d.id} style={{ border: `1px solid ${colors.hairline}`, background: "#fff", borderRadius: 9, padding: "7px 12px", fontSize: 13, fontWeight: 600, color: colors.rust, cursor: "pointer", flexShrink: 0, opacity: deviceBusy === d.id ? 0.6 : 1 }}>
                      {deviceBusy === d.id ? "..." : "Forget"}
                    </button>
                  </div>
                );
              })}
              <div style={{ marginTop: 12 }}>
                {confirmForgetAll ? (
                  <div style={{ background: colors.rustTint, borderRadius: 10, padding: 12, fontSize: 13, color: colors.ink, lineHeight: 1.5 }}>
                    Forget all {devices.length} devices, including this one? You'll need a sign-in code next time, on every device.
                    <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                      <button onClick={forgetAllDevices} disabled={deviceBusy === "all"} style={{ border: "none", background: colors.rust, color: "#fff", borderRadius: 8, padding: "7px 12px", fontSize: 13, fontWeight: 700, cursor: "pointer", opacity: deviceBusy === "all" ? 0.6 : 1 }}>
                        {deviceBusy === "all" ? "Removing..." : "Yes, forget all"}
                      </button>
                      <button onClick={() => setConfirmForgetAll(false)} style={{ border: `1px solid ${colors.hairline}`, background: "#fff", borderRadius: 8, padding: "7px 12px", fontSize: 13, fontWeight: 600, color: colors.inkSoft, cursor: "pointer" }}>Cancel</button>
                    </div>
                  </div>
                ) : (
                  <button onClick={() => setConfirmForgetAll(true)} style={{ border: "none", background: "none", color: colors.rust, fontSize: 13, fontWeight: 600, cursor: "pointer", padding: 0, textDecoration: "underline" }}>
                    Forget all devices
                  </button>
                )}
              </div>
            </>
          )}
        </Card>
      )}

      <Card style={{ padding: 20 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: colors.inkFaint, textTransform: "uppercase", letterSpacing: 0.4, marginBottom: 10 }}>
          Account
        </div>
        <button
          onClick={() => { setChangingPassword((v) => !v); setPwError(null); setPwDone(false); }}
          style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 0", border: "none", background: "none", cursor: "pointer", width: "100%", textAlign: "left", borderBottom: `1px solid ${colors.hairline}` }}
        >
          <Lock size={15} color={colors.inkSoft} />
          <span style={{ fontSize: 13.5, color: colors.ink }}>Change Password</span>
        </button>

        {changingPassword && (
          <div style={{ padding: "14px 0", borderBottom: `1px solid ${colors.hairline}` }}>
            {pwDone ? (
              <p style={{ fontSize: 13, color: colors.sage, margin: 0, fontWeight: 600 }}>Password updated.</p>
            ) : (
              <form onSubmit={submitPasswordChange}>
                <div style={{ position: "relative", marginBottom: 8 }}>
                  <input
                    type={showPw ? "text" : "password"}
                    required
                    minLength={8}
                    value={newPw}
                    onChange={(e) => setNewPw(e.target.value)}
                    placeholder="New password (at least 8 characters)"
                    style={{ width: "100%", padding: "10px 38px 10px 10px", borderRadius: 8, border: `1px solid ${colors.hairline}`, boxSizing: "border-box", fontSize: 13.5 }}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPw((v) => !v)}
                    aria-label={showPw ? "Hide password" : "Show password"}
                    style={{ position: "absolute", right: 8, top: "50%", transform: "translateY(-50%)", border: "none", background: "none", cursor: "pointer", padding: 4, display: "flex", color: colors.inkFaint }}
                  >
                    {showPw ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>
                <input
                  type={showPw ? "text" : "password"}
                  required
                  minLength={8}
                  value={confirmPw}
                  onChange={(e) => setConfirmPw(e.target.value)}
                  placeholder="Confirm new password"
                  style={{ width: "100%", padding: "10px 12px", borderRadius: 8, border: `1px solid ${colors.hairline}`, boxSizing: "border-box", fontSize: 13.5, marginBottom: 10 }}
                />
                <button type="submit" disabled={pwBusy} style={{ width: "100%", padding: 10, borderRadius: 8, border: "none", background: colors.sage, color: "#fff", fontWeight: 700, cursor: pwBusy ? "default" : "pointer", opacity: pwBusy ? 0.7 : 1, fontSize: 13.5 }}>
                  {pwBusy ? "Please wait..." : "Update Password"}
                </button>
                {pwError && <p style={{ color: colors.rust, fontSize: 13, marginTop: 8, marginBottom: 0 }}>{pwError}</p>}
              </form>
            )}
          </div>
        )}

        <button onClick={onSignOut} style={{ display: "flex", alignItems: "center", gap: 8, padding: "12px 0 2px", border: "none", background: "none", cursor: "pointer", color: colors.rust, width: "100%", textAlign: "left" }}>
          <LogOut size={15} />
          <span style={{ fontSize: 13.5, fontWeight: 600 }}>Log out</span>
        </button>
      </Card>
    </div>
  );
}

/* ---------------------------------------------------------
   Main app
--------------------------------------------------------- */
const blankDraft = () => Object.fromEntries(SYMPTOMS.map((s) => [s.key, null]));

// Everything inside a patient's page, and which of the four tabs it belongs to. The screens themselves keep their own names;
// Care and Schedule each hold a few of them behind a small switch.
const PATIENT_TAB_OF = {
  today: "today", checkin: "today", results: "today", safety: "today",
  progress: "progress", recovery: "progress",
  medications: "care", exercises: "care", careplan: "care", details: "care",
  visits: "schedule", appointments: "schedule",
};
const PATIENT_TABS = [
  { key: "today", label: "Today", icon: ClipboardList, opens: "today" },
  { key: "progress", label: "Progress", icon: Activity, opens: "progress" },
  { key: "care", label: "Care", icon: Pill, opens: "careplan" },
  { key: "schedule", label: "Schedule", icon: CalendarDays, opens: "visits" },
];
const SUB_TABS = {
  care: [["careplan", "Care plan"], ["medications", "Medications"], ["exercises", "Exercises"]],
  schedule: [["visits", "Visits"], ["appointments", "Appointments"]],
};
const lastSub = {}; // which part of Care / Schedule was open last, so the tab returns to it
// While a caregiver is off shift they see the handover, the care plan (with the emergency information) and the schedule, but
// not the working screens or the progress. These are the views that stay closed until they are on shift.
const OFF_SHIFT_CLOSED = { checkin: "Today's symptom check-in", results: "Today's symptom check-in", progress: "Progress", recovery: "Progress", medications: "Medications", exercises: "Exercises" };

function PatientHeader({ patient, profile, onBack }) {
  const age = ageFromDob(profile.dob);
  const meta = [age !== null ? `${age} yrs` : null, profile.strokeType && profile.strokeType !== "Not sure" ? `${profile.strokeType} stroke` : null].filter(Boolean).join(" · ");
  return (
    <div className="no-print" style={{ marginBottom: 14 }}>
      <button onClick={onBack} style={{ display: "flex", alignItems: "center", gap: 6, border: "none", background: "none", color: colors.sageDeep, fontSize: 13, fontWeight: 600, cursor: "pointer", padding: "10px 8px", margin: "-10px -8px 0" }}>
        <ArrowLeft size={15} /> All patients
      </button>
      <h1 style={{ fontFamily: "Fraunces, serif", fontSize: 24, fontWeight: 600, color: colors.ink, margin: 0 }}>{patient.full_name}</h1>
      {meta && <div style={{ fontSize: 13, color: colors.inkFaint, marginTop: 2 }}>{meta}</div>}
    </div>
  );
}

function PatientTabs({ active, view, onChange, offShift = false }) {
  const subs = SUB_TABS[active];
  const current = view === "details" ? "careplan" : view;
  if (subs && subs.some(([k]) => k === current)) lastSub[active] = current;
  return (
    <div className="no-print" style={{ marginBottom: 16 }}>
      <div style={{ display: "flex", gap: 4, background: "#fff", borderRadius: 14, padding: 4, boxShadow: "0 1px 3px rgba(32,38,31,0.06), 0 6px 16px rgba(32,38,31,0.05)" }}>
        {PATIENT_TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => onChange(offShift && t.key === "care" ? "careplan" : lastSub[t.key] || t.opens)}
            title={offShift && t.key === "progress" ? "Opens while you are on shift" : undefined}
            aria-current={active === t.key ? "page" : undefined}
            style={{
              flex: 1, minWidth: 0, padding: "10px 2px", borderRadius: 10, border: "none", cursor: "pointer", fontSize: 13, fontWeight: 700,
              display: "flex", alignItems: "center", justifyContent: "center", gap: 4,
              background: active === t.key ? colors.sageTint : "transparent", color: active === t.key ? colors.sageDeep : colors.inkSoft,
            }}
          >
            <t.icon size={14} /> {t.label}
            {offShift && t.key === "progress" && <Lock size={11} aria-label="Opens while you are on shift" />}
          </button>
        ))}
      </div>
      {subs && subs.length > 1 && (
        <div style={{ display: "flex", background: "#F1EEE4", borderRadius: 11, padding: 3, marginTop: 10 }}>
          {subs.map(([key, label]) => (
            <button key={key} onClick={() => onChange(key)} aria-pressed={current === key}
              style={{ flex: 1, minWidth: 0, padding: "8px 4px", borderRadius: 9, border: "none", cursor: "pointer", fontSize: 13, fontWeight: 700, background: current === key ? "#fff" : "transparent", color: current === key ? colors.sageDeep : colors.inkSoft, boxShadow: current === key ? "0 1px 2px rgba(0,0,0,0.08)" : "none" }}>
              {label}
              {offShift && OFF_SHIFT_CLOSED[key] && <Lock size={11} aria-label="Opens while you are on shift" style={{ marginLeft: 4, verticalAlign: -1 }} />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export default function StroviaPrototype({ userEmail, userId, member, onSignOut, onMemberUpdated }) {
  const role = member.role; // "admin" | "caregiver" | "relative"
  const isAdmin = role === "admin";
  const memberName = [member.first_name, member.last_name].filter(Boolean).join(" ") || userEmail;
  const wide = useWide();

  const [patients, setPatients] = useState([]);
  const [patientsLoading, setPatientsLoading] = useState(true);
  const [patientId, setPatientId] = useState(null);
  const [overview, setOverview] = useState({}); // patient id -> recent check-ins, for the patient list
  const [people, setPeople] = useState([]); // who is on each patient's care team, for the patient list
  const [actions, setActions] = useState([]); // what was done about severe symptoms (last 14 days)
  const [allShifts, setAllShifts] = useState([]); // every shift (administrator only), for the coverage line on Home
  const [accountList, setAccountList] = useState([]); // administrator only: names and phone numbers, for the quick-call button
  const [queued, setQueued] = useState(() => pendingCount(userId)); // check-ins waiting on this phone for a signal
  const [refusedCheckins, setRefusedCheckins] = useState(0); // a queued check-in the server refused once signal returned (never silently dropped)
  const [careOverview, setCareOverview] = useState({ tasks: [], incidents: [], questions: [], medications: [], attendance: [] }); // for the patient list
  const [setup, setSetup] = useState(false); // true while the administrator sets up a patient just added (details, then care plan)
  const [setupNext, setSetupNext] = useState(false); // shows "now assign a caregiver" once the setup is finished
  const [entries, setEntries] = useState([]);
  const [view, setView] = useState("home");
  const [messageWith, setMessageWith] = useState(null); // someone to start a private conversation with, from a Message button
  const [draft, setDraft] = useState(blankDraft);
  const [feelingDraft, setFeelingDraft] = useState(3);
  const [onsetDraft, setOnsetDraft] = useState("");
  const [notesDraft, setNotesDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(null);
  const [aiInsights, setAiInsights] = useState(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [pending, setPending] = useState(0); // accounts waiting for the administrator's approval
  const appts = useAppointments(userId);
  const reminder = useReminderAlarm(appts.appointments, userId);
  const myShifts = useMyShifts(role === "caregiver");
  const visits = useVisits();
  const care = useCareToday(patientId, role);

  const patient = patients.find((p) => p.id === patientId) || null;
  const profile = useMemo(
    () => ({ ...emptyProfile(), ...(patient?.profile || {}), fullName: patient?.full_name || patient?.profile?.fullName || "" }),
    [patient],
  );
  const patientAppointments = useMemo(
    () => appts.appointments.filter((a) => a.patient_id === patientId),
    [appts.appointments, patientId],
  );
  const nextAppointmentFor = useCallback(
    (id) => appts.appointments.find((a) => a.patient_id === id && new Date(a.starts_at).getTime() >= Date.now()) || null,
    [appts.appointments],
  );

  const inPatientView = view in PATIENT_TAB_OF;
  const shownView = inPatientView && !patient ? "home" : view;

  useEffect(() => {
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = "https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,500;9..144,600&family=Inter:wght@400;500;600;700&display=swap";
    document.head.appendChild(link);
    return () => document.head.removeChild(link);
  }, []);

  // Only the patients this account may see come back: RLS limits caregivers and family to their assignments.
  const loadPatients = useCallback(async () => {
    const { data, error } = await supabase.from("patients").select("id, full_name, profile, care_plan").is("archived_at", null).order("full_name");
    if (!error) setPatients(data || []);
    setPatientsLoading(false);
  }, []);

  useEffect(() => { loadPatients(); }, [loadPatients]);

  // The last two weeks of check-ins for every patient, so the list can show who needs attention.
  const loadOverview = useCallback(async () => {
    const since = toISODate(new Date(Date.now() - 14 * 86400000));
    const { data, error } = await supabase
      .from("checkins").select("patient_id, entry_date, symptoms, recorded_by, updated_at").gte("entry_date", since).order("entry_date", { ascending: true });
    if (error || !data) return;
    const grouped = {};
    data.forEach((row) => {
      (grouped[row.patient_id] ||= []).push({ date: new Date(row.entry_date + "T00:00:00"), symptoms: row.symptoms, logged: true, by: row.recorded_by, at: row.updated_at });
    });
    setOverview(grouped);
  }, []);

  // The caregivers and family on each patient, and the names of whoever recently checked in.
  const loadPeople = useCallback(async () => {
    const { data, error } = await supabase.rpc("home_people");
    if (!error && data) { registerAvatars(data); setPeople(data); }
  }, []);
  useEffect(() => { registerAvatars([{ user_id: userId, avatar_path: member.avatar_path || null }]); }, [userId, member.avatar_path]);
  const isStaff = role === "admin" || role === "caregiver"; // family members and health proxies never get Messages
  const messaging = useMessaging(isStaff);
  const training = useMyTraining(userId, role === "caregiver");
  const [trainingOpenId, setTrainingOpenId] = useState(null);
  const [trainingToCheck, setTrainingToCheck] = useState(0); // administrator: completed work waiting to be checked
  const loadTrainingToCheck = useCallback(async () => {
    if (!isAdmin) return;
    const { data } = await supabase.from("training_assignments").select("id").eq("status", "submitted");
    setTrainingToCheck((data || []).length);
  }, [isAdmin]);
  useEffect(() => {
    loadTrainingToCheck();
    if (!isAdmin) return undefined;
    const timer = setInterval(loadTrainingToCheck, 60000);
    return () => clearInterval(timer);
  }, [loadTrainingToCheck, isAdmin]);
  const trainingBadge = role === "caregiver" ? training.todo.length : isAdmin ? trainingToCheck : 0;
  const openTraining = (id) => { setTrainingOpenId(id); setView("training"); };
  const messageUser = (uid) => { if (!isStaff || !uid || uid === userId) return; setMessageWith(uid); setView("messages"); };

  const loadActions = useCallback(async () => {
    const since = toISODate(new Date(Date.now() - 14 * 86400000));
    const { data, error } = await supabase.from("symptom_actions").select("*").gte("entry_date", since).order("created_at", { ascending: true });
    if (!error && data) setActions(data);
  }, []);

  const loadAllShifts = useCallback(async () => {
    if (!isAdmin) return;
    const { data, error } = await supabase.from("shifts").select("*");
    if (!error && data) setAllShifts(data);
  }, [isAdmin]);

  // Today's tasks, recent incidents, open questions and who has arrived, for every patient the person may see.
  const loadCareOverview = useCallback(async () => {
    const since48 = new Date(Date.now() - 48 * 3600 * 1000).toISOString();
    const since24 = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
    const since14d = new Date(Date.now() - 14 * 24 * 3600 * 1000).toISOString();
    const [t, i, q, a, m, ml] = await Promise.all([
      supabase.from("task_log").select("patient_id, task").eq("task_date", toISODate(new Date())),
      supabase.from("incidents").select("id, patient_id, kind, injury, happened_at").gte("happened_at", since48).order("happened_at", { ascending: false }),
      supabase.from("patient_notes").select("id, patient_id").eq("kind", "question").is("answered_at", null),
      supabase.from("shift_attendance").select("id, patient_id, caregiver_id, planned_start, arrived_at, left_at").gte("arrived_at", since14d),
      supabase.from("medication_log").select("patient_id, med_name, scheduled_for, status, created_at").gte("created_at", since48),
      supabase.from("meal_log").select("patient_id, meal").eq("log_date", toISODate(new Date())),
    ]);
    const rows = a.data || [];
    setCareOverview({
      tasks: t.data || [], meals: ml.data || [], incidents: i.data || [], questions: q.data || [], medications: m.data || [],
      attendance: rows.filter((x) => new Date(x.arrived_at) >= new Date(since24)),
      // Caregivers who have used "I've arrived" lately: only they can be flagged for not arriving.
      arrivers: [...new Set(rows.map((x) => x.caregiver_id))],
    });
  }, []);

  const careFor = useCallback((id) => {
    const p = patients.find((x) => x.id === id);
    const plan = resolveCarePlan(p?.care_plan, p?.profile);
    // Only tasks that have opened count: a day carer is not "behind" on Dinner at 3 PM.
    const tasks = (plan.tasks || []).filter((t) => !isBefore(new Date(), taskOpensAt(plan.taskTimes, t)));
    const meds = todaysProgress(plan.medSchedule, careOverview.medications.filter((x) => x.patient_id === id));
    return {
      // Meals count as tasks on the Home page: the meals that have opened, and how many of them have been recorded today.
      tasksTotal: tasks.length + openMeals().length,
      tasksDone: careOverview.tasks.filter((t) => t.patient_id === id && tasks.includes(t.task)).length
        + (careOverview.meals || []).filter((x) => x.patient_id === id && openMeals().some((m) => m.key === x.meal)).length,
      medsTotal: meds.total, medsGiven: meds.given,
      incident: careOverview.incidents.find((x) => x.patient_id === id) || null,
      questions: careOverview.questions.filter((x) => x.patient_id === id).length,
      attendance: careOverview.attendance.filter((x) => x.patient_id === id),
      arrivers: careOverview.arrivers || [],
    };
  }, [patients, careOverview]);

  const onHome = view === "home";
  useEffect(() => { if (onHome) { loadOverview(); loadPeople(); loadActions(); loadAllShifts(); loadCareOverview(); } }, [loadOverview, loadPeople, loadActions, loadAllShifts, loadCareOverview, onHome]);
  useEffect(() => { if (patientId) { loadPeople(); loadActions(); } }, [patientId, loadPeople, loadActions]);

  useEffect(() => {
    if (!isAdmin) return;
    let cancelled = false;
    Promise.all([supabase.rpc("admin_list_accounts"), supabase.from("profile_change_requests").select("id").eq("status", "pending")]).then(([{ data }, reqs]) => {
      if (!cancelled && data) { setPending(data.filter((a) => a.role && !a.approved && !a.suspended).length + (reqs.data || []).length); registerAvatars(data); setAccountList(data); }
    });
    return () => { cancelled = true; };
  }, [isAdmin, view]);

  // A patient that is no longer visible (removed, or unassigned) closes its page.
  useEffect(() => {
    if (patientId && !patientsLoading && !patients.some((p) => p.id === patientId)) {
      setPatientId(null);
    }
  }, [patients, patientId, patientsLoading]);

  useEffect(() => {
    setEntries([]);
    setAiInsights(null);
    setDraft(blankDraft());
    setFeelingDraft(3);
    setOnsetDraft("");
    setNotesDraft("");
    if (!patientId) return;
    let cancelled = false;
    (async () => {
      const { data, error } = await supabase
        .from("checkins")
        .select("entry_date, symptoms, feeling, notes, onset_note, recorded_by, updated_at")
        .eq("patient_id", patientId)
        .order("entry_date", { ascending: true });
      if (!cancelled && !error && data) {
        const todayStr = toISODate(new Date());
        setEntries(
          data.map((row) => ({
            date: new Date(row.entry_date + "T00:00:00"),
            symptoms: row.symptoms,
            feeling: row.feeling,
            notes: row.notes || "",
            onset: row.onset_note || "",
            logged: true,
            isToday: row.entry_date === todayStr,
            by: row.recorded_by,
            at: row.updated_at,
          }))
        );
      }
      const insights = await supabase.from("ai_insights").select("*").eq("patient_id", patientId).maybeSingle();
      if (!cancelled && !insights.error && insights.data) setAiInsights(insights.data);
    })();
    return () => { cancelled = true; };
  }, [patientId]);

  const hasLoggedToday = useMemo(() => {
    const todayStr = toISODate(new Date());
    return entries.some((e) => toISODate(e.date) === todayStr);
  }, [entries]);

  const trends = useMemo(() => computeSymptomTrends(entries), [entries]);
  const anomalies = useMemo(() => detectAnomalies(entries), [entries]);
  const streak = useMemo(() => computeStreak(entries), [entries]);
  const badges = useMemo(() => computeBadges(entries, trends, streak), [entries, trends, streak]);
  // The recovery score is built from every check-in anyone on the team saved for a day, not only the last one.
  const progress = useProgress(patientId);
  const symptomKeys = useMemo(() => SYMPTOMS.map((s) => s.key), []);
  const scoreDays = useMemo(() => combineDays(progress.versions, progress.vitals, symptomKeys), [progress.versions, progress.vitals, symptomKeys]);
  const latestScore = scoreDays.length ? scoreDays[scoreDays.length - 1].score : entries.length ? wellnessScore(entries[entries.length - 1].symptoms) : null;
  // The emergency buttons use the worst rating anyone gave a symptom today, so one person's "severe" is not hidden by another's save.
  const alertEntries = useMemo(() => {
    const today = scoreDays.find((d) => d.date === toISODate(new Date()));
    if (!today || today.people.length < 2) return entries;
    const worst = worstSymptoms(today, symptomKeys);
    return entries.map((e) => (e.isToday ? { ...e, symptoms: { ...e.symptoms, ...worst } } : e));
  }, [entries, scoreDays, symptomKeys]);
  const alert = useMemo(() => computeAlert(alertEntries), [alertEntries]);

  const statusFor = useCallback((id) => {
    const list = overview[id] || [];
    const todayStr = toISODate(new Date());
    const latest = list.length ? list[list.length - 1] : null;
    return {
      alert: computeAlert(list),
      checkedInToday: list.some((e) => toISODate(e.date) === todayStr),
      checkin: latest ? { isToday: toISODate(latest.date) === todayStr, date: latest.date, at: latest.at ? new Date(latest.at) : null, by: latest.by } : null,
    };
  }, [overview]);

  const teamFor = useCallback((id) => {
    const team = people.filter((p) => p.patient_id === id && p.on_team);
    const names = (role) => team.filter((p) => p.role === role).sort((a, b) => Number(b.is_primary) - Number(a.is_primary) || a.name.localeCompare(b.name)).map((p) => p.name);
    return { caregivers: names("caregiver"), relatives: names("relative"), primary: team.find((p) => p.role === "caregiver" && p.is_primary)?.name || null };
  }, [people]);

  const personName = useCallback((id, uid) => {
    if (!uid) return null;
    if (uid === userId) return "you";
    return people.find((p) => p.patient_id === id && p.user_id === uid)?.name || null;
  }, [people, userId]);
  const roleWord = (r) => (r === "relative" ? "family" : r === "caregiver" ? "caregiver" : r === "admin" ? "administrator" : null);
  const personInfo = useCallback((uid) => {
    if (!uid) return { name: "Someone", role: null };
    if (uid === userId) return { name: "You", role: roleWord(role) };
    const p = people.find((x) => x.patient_id === patientId && x.user_id === uid);
    return { name: p?.name || "Someone", role: roleWord(p?.role) };
  }, [people, userId, patientId, role]);

  // For the Home card: the latest severe-symptom day (last 3 days) and what was done about it.
  const severeFor = useCallback((id) => {
    const items = overview[id] || [];
    const date = latestSevereDate(items);
    if (!date) return null;
    const done = actions.filter((a) => a.patient_id === id && a.entry_date === date);
    const item = [...items].reverse().find((e) => toISODate(e.date) === date);
    const short = { balance: "Balance", vision: "Vision", face: "Face", arm: "Arm", speech: "Speech", headache: "Headache", fatigue: "Fatigue" };
    return {
      date,
      at: item?.at ? new Date(item.at) : null,
      symptoms: SYMPTOMS.filter((s) => item?.symptoms?.[s.key] === 3).map((s) => short[s.key] || s.label),
      pending: done.length === 0,
      done: done.map((a) => ({
        text: describeAction(a),
        by: personName(id, a.recorded_by),
        at: new Date(a.created_at),
      })),
    };
  }, [overview, actions, personName]);

  // Administrator only: who is on shift for a patient right now, or who is next, and who was scheduled today (so
  // Home can name whoever hasn't checked in or left tasks unfinished). Null if no shifts are set for them.
  const coverageFor = useCallback((id) => {
    const list = allShifts.filter((s) => s.patient_id === id);
    if (!list.length) return null;
    const now = new Date();
    const nameOfShift = (o) => personName(id, o.shift.caregiver_id) || "A caregiver";
    const on = shiftsOnNow(list, now).map((o) => ({ name: nameOfShift(o), until: o.end, start: o.start, caregiverId: o.shift.caregiver_id }));
    const nextShift = on.length ? null : occurrences(list, now, 14).find((o) => o.start > now);
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const startedToday = occurrences(list, startOfToday, 1).filter((o) => o.start <= now);
    const byCaregiver = new Map();
    for (const o of startedToday) {
      const prev = byCaregiver.get(o.shift.caregiver_id);
      if (!prev || o.start > prev.start) byCaregiver.set(o.shift.caregiver_id, o);
    }
    const todayScheduled = [...byCaregiver.values()].map((o) => ({ caregiverId: o.shift.caregiver_id, name: nameOfShift(o), start: o.start, end: o.end, ended: o.end <= now }));
    // Every shift for this patient that touches today (finished, running, or later today), with who it is for.
    const today = occurrences(list, startOfToday, 1).map((o) => ({ caregiverId: o.shift.caregiver_id, name: nameOfShift(o), start: o.start, end: o.end }));
    return { on, next: nextShift ? { name: nameOfShift(nextShift), start: nextShift.start } : null, todayScheduled, today };
  }, [allShifts, personName]);

  // Administrator only: who to phone about a patient: the caregiver on shift now, otherwise the first caregiver.
  const callTargetFor = useCallback((id) => {
    if (!isAdmin) return null;
    const onNow = new Set(shiftsOnNow(allShifts.filter((s) => s.patient_id === id)).map((o) => o.shift.caregiver_id));
    const caregivers = people.filter((p) => p.patient_id === id && p.on_team && p.role === "caregiver");
    const withPhone = caregivers
      .map((p) => ({ userId: p.user_id, name: p.name, onShift: onNow.has(p.user_id), phone: accountList.find((a) => a.user_id === p.user_id)?.phone }))
      .filter((c) => c.phone);
    const pick = withPhone.find((c) => c.onShift) || withPhone[0];
    return pick ? { userId: pick.userId, name: pick.name, phone: pick.phone, onShift: pick.onShift } : null;
  }, [isAdmin, allShifts, people, accountList]);

  function openPatient(id) {
    setPatientId(id);
    setSetup(false);
    setSetupNext(false);
    setView("today");
  }

  // Check-ins saved with no signal are sent as soon as the phone is online again.
  useEffect(() => {
    let stopped = false;
    const flush = async () => {
      if (!pendingCount(userId)) { setQueued(0); return; }
      const result = await flushQueue(supabase, userId);
      if (stopped) return;
      setQueued(pendingCount(userId));
      if (result.sent) { loadOverview(); setSaveError(null); }
      if (result.refused) setRefusedCheckins((n) => n + result.refused); // never drop this silently
    };
    flush();
    window.addEventListener("online", flush);
    const timer = setInterval(flush, 60 * 1000);
    return () => { stopped = true; window.removeEventListener("online", flush); clearInterval(timer); };
  }, [userId, loadOverview]);

  // Leaving the patient screens ends any setup in progress.
  useEffect(() => {
    if (view === "home" || view === "profile" || view === "manage" || view === "shifts" || view === "messages" || view === "training" || view === "guide") { setSetup(false); setSetupNext(false); }
  }, [view]);

  // After a new patient is added the administrator is walked through step 1 (details) and step 2 (care plan).
  function startSetup(id) {
    setPatientId(id);
    setSetup(true);
    setSetupNext(false);
    setView("details");
  }

  async function addPatient(name, dob) {
    const { data, error } = await supabase.from("patients").insert({
      full_name: name,
      profile: { ...emptyProfile(), fullName: name, dob: dob || "" },
      created_by: userId,
    }).select("id").single();
    if (error || !data) return "The patient couldn't be added. Please try again.";
    await loadPatients();
    startSetup(data.id);
    return null;
  }

  function finishSetup(saved) {
    setSetup(false);
    setSetupNext(!!saved);
  }

  async function runAIAnalysis(entriesSoFar, notes, anomalyList) {
    setAiLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("analyze-checkin", {
        body: {
          entries: entriesSoFar.slice(-14).map((e) => ({ date: toISODate(e.date), symptoms: e.symptoms, feeling: e.feeling })),
          profile: { strokeType: profile.strokeType, strokeDate: profile.strokeDate },
          notes,
          hasAnomalies: anomalyList.length > 0,
        },
      });
      if (!error && data && !data.error) {
        setAiInsights(data);
        await supabase.from("ai_insights").upsert({ patient_id: patientId, ...data }, { onConflict: "patient_id" });
      }
    } catch (e) {
      // AI is an enhancement, not a requirement — fall back to the rule-based copy elsewhere in the UI.
    }
    setAiLoading(false);
  }

  async function saveCheckIn() {
    if (!patientId) return;
    const todayEntry = { date: new Date(), symptoms: { ...draft }, feeling: feelingDraft, notes: notesDraft, onset: onsetDraft, logged: true, isToday: true, by: userId, at: new Date().toISOString() };
    let updatedEntries = [];
    setEntries((prev) => {
      const todayStr = toISODate(new Date());
      const withoutToday = prev.filter((e) => toISODate(e.date) !== todayStr);
      updatedEntries = [...withoutToday, todayEntry];
      return updatedEntries;
    });
    setSaveError(null);

    setSaving(true);
    const row = {
      patient_id: patientId, recorded_by: userId, entry_date: toISODate(new Date()),
      symptoms: draft, feeling: feelingDraft, notes: notesDraft, onset_note: onsetDraft,
    };
    const { error } = await supabase.from("checkins").upsert(row, { onConflict: "patient_id,entry_date" });
    setSaving(false);
    if (error && isNetworkError(error)) {
      // No signal: keep it on this device and send it as soon as the connection is back.
      queueCheckin(userId, row);
      setQueued(pendingCount(userId));
      setSaveError("No signal right now. This check-in is saved on your phone and will be sent as soon as you're back online.");
    } else if (error) {
      // A refusal for a real reason (for example, not on shift) gets a specific, useful message; anything
      // unrecognized falls back to a plain one rather than showing raw database text.
      setSaveError(error.code === "P0001" ? error.message : "This check-in couldn't be saved to the account. Check your connection and try again.");
    } else {
      loadOverview();
      progress.reload();
    }

    const anomalyList = detectAnomalies(updatedEntries);
    runAIAnalysis(updatedEntries, notesDraft, anomalyList);

    setView(isSevereEntry(draft) ? "safety" : "results");
  }

  async function saveProfile(next) {
    if (!patientId) return;
    const fullName = next.fullName?.trim() || patient.full_name;
    const { error } = await supabase.from("patients").update({ profile: next, full_name: fullName }).eq("id", patientId);
    if (error) {
      setSaveError("The patient details couldn't be saved. Check your connection and try again.");
      return;
    }
    setPatients((prev) => prev.map((p) => (p.id === patientId ? { ...p, profile: next, full_name: fullName } : p)));
    setView("careplan");
  }

  // Only an administrator's change is accepted by the database; the screen also hides the button from everyone else.
  async function saveCarePlan(plan) {
    const { error } = await supabase.from("patients").update({ care_plan: plan }).eq("id", patientId);
    if (error) return "The care plan couldn't be saved. Please try again.";
    setPatients((prev) => prev.map((p) => (p.id === patientId ? { ...p, care_plan: plan } : p)));
    return null;
  }

  async function printCarePlan() {
    if (patientId) await supabase.rpc("log_care_plan_print", { p_patient: patientId });
    window.print();
  }

  function startEditToday() {
    const todayStr = toISODate(new Date());
    const todayEntry = entries.find((e) => toISODate(e.date) === todayStr);
    if (todayEntry) {
      setDraft(todayEntry.symptoms);
      setFeelingDraft(todayEntry.feeling);
      setNotesDraft(todayEntry.notes || "");
      setOnsetDraft(todayEntry.onset || "");
    }
    setView("checkin");
  }

  const fallbackLevel = recoveryLevelFallback(latestScore);

  // A caregiver may start today's check-in only while on shift for this patient (with a little grace either side).
  // Family proxies and administrators are not shift-bound, and a patient with no shift schedule at all is never
  // blocked by this — shift tracking they haven't adopted should never stop them working.
  const shiftGate = role === "caregiver" && patientId ? shiftWindowStatus(myShifts.shifts, patientId, new Date(), 30, care.attendance, userId) : { allowed: true, tracked: false, next: null };
  // The same shift rule also covers readings, medication and tasks (migration 041): a caregiver can't log any of
  // these while off shift. Family proxies and administrators are never blocked, so this is always false for them.
  const offShift = !shiftGate.allowed;

  // A caregiver who is off shift does not see or change today's symptom check-in: today's ratings are left out of the symptoms
  // list, the score, the trends and the handover. Warnings about severe symptoms are NOT hidden, so a danger sign is never missed.
  const todayStr = toISODate(new Date());
  const shownEntries = offShift ? entries.filter((e) => !e.isToday) : entries;
  const shownScoreDays = offShift ? scoreDays.filter((d) => d.date !== todayStr) : scoreDays;
  const shownScore = shownScoreDays.length ? shownScoreDays[shownScoreDays.length - 1].score : shownEntries.length ? wellnessScore(shownEntries[shownEntries.length - 1].symptoms) : null;
  const shownTrends = offShift ? computeSymptomTrends(shownEntries) : trends;
  const shownAnomalies = offShift ? [] : anomalies;

  function goToCheckin() {
    if (offShift) return;
    if (hasLoggedToday) startEditToday();
    else if (shiftGate.allowed) setView("checkin");
  }

  const patientNavigate = (v) => (v === "checkin" ? goToCheckin() : setView(v));
  const navigate = (v) => {
    if ((v === "manage" && !isAdmin) || (v === "shifts" && role !== "caregiver") || ((v === "messages" || v === "training") && !isStaff)) setView("home");
    else { if (v === "training") setTrainingOpenId(null); setView(v); }
  };

  return (
    <div style={{ background: colors.bg, minHeight: "100vh", fontFamily: "Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif", display: "flex", justifyContent: wide ? "flex-start" : "center", alignItems: wide ? "flex-start" : undefined, padding: wide ? 0 : "16px 16px 90px" }}>
      {wide && <SideNav view={shownView} setView={navigate} role={role} pending={pending} unread={messaging.unread} trainingBadge={trainingBadge} name={memberName} userId={userId} />}
      <div style={wide
        ? { flex: 1, minWidth: 0, maxWidth: inPatientView && patient && (view === "today" || view === "progress") ? 1120 : 840, margin: "0 auto", padding: "28px 32px 48px", boxSizing: "border-box" }
        : { width: "100%", maxWidth: 760 }}>
        {!wide && <TopBar setView={setView} />}

        {queued > 0 && (
          <div style={{ background: colors.goldTint, border: `1px solid ${colors.gold}`, borderRadius: 12, padding: "10px 14px", marginBottom: 12, fontSize: 13.5, color: colors.ink, lineHeight: 1.45 }}>
            <strong>{queued} {queued === 1 ? "check-in is" : "check-ins are"} waiting to be sent.</strong> There's no signal right now. Keep Strovia open or come back later: it sends by itself as soon as you're online.
          </div>
        )}
        {refusedCheckins > 0 && (
          <div style={{ background: colors.rustTint, border: `1px solid ${colors.rust}`, borderRadius: 12, padding: "10px 14px", marginBottom: 12, fontSize: 13.5, color: colors.ink, lineHeight: 1.45, display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center" }}>
            <span><strong>{refusedCheckins} {refusedCheckins === 1 ? "check-in" : "check-ins"} saved on this phone could not be sent</strong> once the connection came back — most often because the shift it was meant for has since ended. Open the patient and check whether it still needs to be entered.</span>
            <button onClick={() => setRefusedCheckins(0)} style={{ border: "none", background: "none", color: colors.rust, fontWeight: 700, cursor: "pointer", flexShrink: 0 }}>Dismiss</button>
          </div>
        )}

        {shownView === "home" && isAdmin && (
          <PatientsHome
            member={member} patients={patients} loading={patientsLoading} isAdmin={isAdmin}
            statusFor={statusFor} nextAppointmentFor={nextAppointmentFor} teamFor={teamFor} personName={personName} severeFor={severeFor} coverageFor={coverageFor} callTargetFor={callTargetFor} careFor={careFor} pending={pending}
            onOpen={openPatient} onAddPatient={addPatient} onOpenManage={() => setView("manage")} userId={userId} onMessage={messageUser}
          />
        )}
        {shownView === "home" && !isAdmin && (
          <MemberHome
            member={member} patients={patients} loading={patientsLoading}
            statusFor={statusFor} nextAppointmentFor={nextAppointmentFor} teamFor={teamFor} personName={personName} severeFor={severeFor} careFor={careFor}
            onOpen={openPatient} myShifts={role === "caregiver" ? myShifts.shifts : null} userId={userId} onClockChange={loadCareOverview} training={role === "caregiver" ? training : null} onOpenTraining={openTraining}
          />
        )}
        {shownView === "shifts" && role === "caregiver" && (
          <div>
            <h1 style={{ fontFamily: "Fraunces, serif", fontSize: 25, fontWeight: 600, color: colors.ink, margin: "0 0 14px" }}>My shifts</h1>
            <MyShifts shifts={myShifts.shifts} patients={patients} loading={myShifts.loading} onOpenPatient={openPatient} />
          </div>
        )}

        {inPatientView && patient && (
          <>
            <PatientHeader patient={patient} profile={profile} onBack={() => setView("home")} />
            <PatientTabs active={PATIENT_TAB_OF[view]} view={view} onChange={setView} offShift={offShift} />

            {view === "today" && role === "caregiver" && <ShiftBanner shifts={myShifts.shifts} patientId={patientId} />}
            {view === "today" && (
              <ActionTaken patientId={patientId} entries={entries} actions={actions} userId={userId} nameFor={personName} onSaved={loadActions} />
            )}
            {view === "today" && (
              <div style={wide ? { display: "grid", gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)", gap: 20, alignItems: "start" } : undefined}>
                <div>
                  <TodayTop
                    patient={patient} profile={profile} entries={entries} alert={alert} appointments={patientAppointments}
                    severeDone={actions.some((a) => a.patient_id === patientId && a.entry_date === toISODate(new Date()))}
                    plan={resolveCarePlan(patient.care_plan, profile)} care={care} userId={userId} role={role} myShifts={myShifts.shifts} personName={personName}
                    overview={careFor(patientId)} visits={visits.visits} anomalies={shownAnomalies} offShift={offShift} onMessage={isStaff ? messageUser : undefined}
                  />
                </div>
                <div>
                  <TodayView
                    setView={patientNavigate} entries={shownEntries} alert={alert} streak={streak}
                    hasLoggedToday={hasLoggedToday} latestScore={shownScore} offShift={offShift}
                    extras={<TodayTools patient={patient} profile={profile} plan={resolveCarePlan(patient.care_plan, profile)} care={care} userId={userId} isAdmin={isAdmin} isStaff={isStaff} personName={personName} printedBy={memberName} offShift={offShift} onOpenExercises={() => setView("exercises")} notesNode={<NotesCard patientId={patientId} member={member} userId={userId} isAdmin={isAdmin} nameFor={personName} />} />}
                    shiftGate={shiftGate}
                  />
                </div>
              </div>
            )}
            {view === "medications" && !offShift && (
              <Medication
                patientId={patientId} userId={userId} nameFor={personName}
                schedule={resolveCarePlan(patient.care_plan, profile).medSchedule} log={care.medications} onSaved={care.reload}
                offShift={offShift}
              />
            )}
            {view === "exercises" && !offShift && (
              <Exercises
                patientId={patientId} userId={userId} isAdmin={isAdmin} patientName={patient.full_name} nameFor={personName}
                plans={care.exercisePlans} exercises={care.exercises} log={care.exerciseLog} onChanged={care.reload}
                offShift={offShift}
              />
            )}
            {OFF_SHIFT_CLOSED[view] && offShift && (
              <Card style={{ padding: 20 }}>
                <div style={{ fontSize: 15, fontWeight: 700, color: colors.ink, marginBottom: 4 }}>{OFF_SHIFT_CLOSED[view]}</div>
                <p style={{ fontSize: 13.5, color: colors.inkSoft, margin: "0 0 12px", lineHeight: 1.5 }}>
                  You can see and use this while you are on shift. Until then you can read the handover, the care plan and the schedule.{" "}
                  {shiftGate.next ? `Your next shift starts ${shiftGate.next.start.toLocaleString(undefined, { weekday: "short", hour: "numeric", minute: "2-digit" })}.` : "Call the office if you need it outside your shift."}
                </p>
                <button onClick={() => setView("today")} style={{ border: "none", background: colors.sage, color: "#fff", borderRadius: 10, padding: "10px 16px", fontSize: 13.5, fontWeight: 700, cursor: "pointer" }}>Back to Today</button>
              </Card>
            )}
            {view === "checkin" && !offShift && (
              <CheckInView
                draft={draft} setDraft={setDraft}
                feelingDraft={feelingDraft} setFeelingDraft={setFeelingDraft}
                onsetDraft={onsetDraft} setOnsetDraft={setOnsetDraft}
                notesDraft={notesDraft} setNotesDraft={setNotesDraft}
                saveCheckIn={saveCheckIn} saving={saving}
                existing={entries.find((e) => e.isToday) || null}
                previous={[...entries].filter((e) => !e.isToday).slice(-1)[0] || null}
                nameFor={personName} patientId={patientId} userId={userId}
              />
            )}
            {view === "results" && !offShift && (
              <ResultsView
                entries={entries} anomalies={anomalies} alert={alert} aiInsights={aiInsights} aiLoading={aiLoading}
                setView={setView} startEditToday={startEditToday}
              />
            )}
            {view === "safety" && (
              <>
                <SafetyView setView={setView} />
                <div style={{ height: 14 }} />
                <ActionTaken patientId={patientId} entries={entries} actions={actions} userId={userId} nameFor={personName} onSaved={loadActions} heading="Now record what you did" />
              </>
            )}
            {view === "careplan" && setupNext && (
              <div className="no-print" style={{ background: colors.sageTint, borderRadius: 12, padding: "12px 14px", marginBottom: 12 }}>
                <div style={{ fontSize: 14, fontWeight: 700, color: colors.sageDeep }}>{profile.fullName || "The patient"} is set up.</div>
                <div style={{ fontSize: 13, color: colors.ink, lineHeight: 1.5, margin: "3px 0 10px" }}>
                  Next, assign a caregiver or family proxy in Manage Accounts, under Patients. Until you do, nobody else can see this patient.
                </div>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <button onClick={() => { setSetupNext(false); setView("manage"); }} style={{ border: "none", background: colors.sage, color: "#fff", borderRadius: 9, padding: "8px 14px", fontSize: 13, fontWeight: 700, cursor: "pointer" }}>Open Manage Accounts</button>
                  <button onClick={() => setSetupNext(false)} style={{ border: `1px solid ${colors.hairline}`, background: "#fff", color: colors.inkSoft, borderRadius: 9, padding: "8px 14px", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>Later</button>
                </div>
              </div>
            )}
            {view === "careplan" && (
              <CarePlan
                key={setup ? "setup" : "view"}
                profile={profile} savedPlan={patient.care_plan} viewer={{ name: memberName, role }} patientId={patientId}
                alert={alert} isAdmin={isAdmin} onPrint={printCarePlan} onSavePlan={saveCarePlan}
                onEditDetails={() => setView("details")} setView={setView}
                setup={setup} onSetupDone={finishSetup}
              />
            )}
            {view === "details" && (
              <PatientDetailsEditor profile={profile} onSave={saveProfile} onCancel={() => setView("careplan")} onSkip={() => setView("careplan")} setup={setup} />
            )}
            {view === "visits" && (
              <PatientVisits patientId={patientId} visits={visits.visits} userId={userId} isAdmin={isAdmin} onChanged={visits.reload} nameFor={personName} />
            )}
            {view === "appointments" && (
              <AppointmentsView
                patient={{ id: patient.id, name: profile.fullName }}
                appointments={patientAppointments} loading={appts.loading} loadError={appts.error}
                save={appts.save} remove={appts.remove} userKey={userId} nameFor={personName}
              />
            )}
            {view === "progress" && !offShift && (
              <ProgressView entries={shownEntries} trends={shownTrends} latestScore={shownScore} streak={streak} profile={profile} setView={setView} incidents={care.incidents} actions={actions.filter((a) => a.patient_id === patientId)} scoreDays={shownScoreDays} wide={wide} infoOf={personInfo} carePlan={carePlanFollowed({ plan: resolveCarePlan(patient.care_plan, profile), exercises: care.exercises, visits: visits.visits.filter((v) => v.patient_id === patientId), data: progress })} />
            )}
            {view === "recovery" && !offShift && (
              <RecoveryView
                setView={setView} entries={shownEntries} trends={shownTrends} latestScore={shownScore}
                profile={profile} badges={badges} aiInsights={aiInsights} aiLoading={aiLoading}
              />
            )}
          </>
        )}

        {view === "guide" && <HowItWorks role={role} />}
        {view === "profile" && <ProfileView member={member} userEmail={userEmail} userId={userId} onSignOut={onSignOut} onMemberUpdated={onMemberUpdated} training={role === "caregiver" ? training : null} onOpenTraining={openTraining} />}
        {view === "training" && role === "caregiver" && (
          <MyTrainingView userId={userId} member={member} training={training} initialId={trainingOpenId} onBack={() => setView("home")} />
        )}
        {view === "training" && isAdmin && (
          <div>
            <h1 style={{ fontFamily: "Fraunces, serif", fontSize: 25, fontWeight: 600, color: colors.ink, margin: "0 0 10px" }}>Training</h1>
            <TrainingAdmin userId={userId} accounts={accountList} onChanged={loadTrainingToCheck} />
          </div>
        )}
        {view === "messages" && isStaff && (
          <MessagesView userId={userId} patients={patients} messaging={messaging} onOpenPatient={openPatient} wide={wide} startWith={messageWith} onStarted={() => setMessageWith(null)} />
        )}
        {view === "manage" && isAdmin && (
          <ManageAccounts userId={userId} patients={patients} onPatientsChanged={loadPatients} onPendingChanged={setPending} onPatientAdded={startSetup} onMessage={messageUser} />
        )}

        {saveError && (
          <div style={{ position: "fixed", bottom: 74, left: 16, right: 16, maxWidth: 728, margin: "0 auto", display: "flex", gap: 10, alignItems: "flex-start", padding: "12px 14px", borderRadius: 12, background: colors.goldTint, boxShadow: "0 4px 16px rgba(32,38,31,0.12)" }}>
            <AlertTriangle size={16} color={colors.gold} style={{ marginTop: 1, flexShrink: 0 }} />
            <span style={{ fontSize: 13, color: colors.ink, lineHeight: 1.4, flex: 1 }}>{saveError}</span>
            <button onClick={() => setSaveError(null)} aria-label="Dismiss" style={{ border: "none", background: "none", cursor: "pointer", color: colors.inkSoft, fontSize: 16, lineHeight: 1 }}>×</button>
          </div>
        )}
      </div>
      {!wide && <BottomNav view={shownView} setView={navigate} role={role} pending={pending} unread={messaging.unread} trainingBadge={trainingBadge} />}
      <ReminderAlarm alarm={reminder.alarm} onDismiss={reminder.dismiss} onSnooze={reminder.snooze} />
    </div>
  );
}
