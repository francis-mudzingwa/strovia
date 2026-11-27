import React, { useState } from "react";
import {
  MapPin, HeartPulse, Pill, Bell, ArrowRightLeft, ClipboardCheck, MessageSquare, GraduationCap, Lock, ChevronDown,
  LayoutDashboard, Users, SlidersHorizontal, CalendarClock, ShieldCheck, TrendingUp, Eye, BookOpen, CalendarDays, HeartHandshake,
} from "lucide-react";

// "How Strovia works": a short tour for each kind of account. Plain words, no medical claims, and only things the app really does.
// A strip at the top shows the flow at a glance; each step below folds open for the detail.

const c = {
  ink: "#20261F", soft: "#5C6357", hair: "#E5DFD1", sage: "#3F6C51", deep: "#2C4E3A", tint: "#E3EBE0",
  card: "#FFFFFF", amber: "#7A5A12", amberTint: "#F3E7CC", rust: "#A24632", rustTint: "#F3DAD2",
};

const ROLES = [
  { key: "caregiver", label: "Caregiver" },
  { key: "admin", label: "Administrator" },
  { key: "relative", label: "Family" },
];

const INTRO = "Strovia helps a care team look after someone recovering from a stroke. Caregivers record the day, family can follow how recovery is going, and the administrator keeps the team and the care plans in order. What you see depends on who you are and which patients you are assigned to.";

// flow: the picture at the top. warn marks the step that is about alerts.
const FLOW = {
  caregiver: { line: "One shift, from arrival to handover", items: [["Arrive", MapPin], ["Check in", HeartPulse], ["Record", Pill], ["Alert", Bell, true], ["Hand over", ArrowRightLeft]] },
  admin: { line: "Running the team, from set-up to review", items: [["Set up", Users], ["Care plans", SlidersHorizontal], ["Schedule", CalendarClock], ["Alerts", Bell, true], ["Review", ShieldCheck]] },
  relative: { line: "Following recovery, from home", items: [["Progress", TrendingUp], ["The day", Eye], ["The plan", Pill], ["Schedule", CalendarDays], ["Alerts", Bell, true]] },
};

// [icon, title, one-line summary, detail]
const STEPS = {
  caregiver: [
    [MapPin, "Start your shift", "Tap Arrive. Recording opens.", "Open My shifts and tap Arrive when you reach the patient. You can record care only while you are on shift, and leaving the shift ends your editing for that patient. Long and back-to-back shifts are fine."],
    [ClipboardCheck, "Record the day on Today", "Check-in, medicines, meals.", "Do the symptom check-in, then log readings, medicines, exercises, meals, bowel movements and any tasks. Afternoon exercises and lunch open at 12 noon, dinner opens at 5 PM. Cards that are finished fold into one line so you can see what is left."],
    [Bell, "Watch the colours", "Green, amber, red.", "Amber means something needs attention, red means act now. A missing check-in turns amber from noon and red from 6 PM. Blood or black stool, readings outside the care plan, and a medicine that was never logged all alert the care team."],
    [MessageSquare, "Talk to the team", "Messages and handoff.", "Messages is private to staff: everyone, a patient's team, or one person. An urgent message also reaches the phone. At the end of a shift the Handoff summary lists what happened, so the next person starts informed."],
    [GraduationCap, "Keep learning", "Quizzes mark you at once.", "Training holds the courses your administrator sets. Quizzes show your mark straight away, and you can retake one as many times as you need. A pass goes to the administrator, who issues your certificate."],
    [Lock, "Your privacy", "Only your patients.", "You see only the patients you are assigned to. Strovia signs you out after 10 minutes without use, so a shared phone stays safe."],
  ],
  admin: [
    [LayoutDashboard, "Home shows the day", "Who is on duty, who is late.", "See who is on duty, who has not arrived yet, which patients need attention, and upcoming birthdays. Yellow cards point to things still to set up."],
    [Users, "Manage people", "Accounts, patients, shifts.", "In Manage you approve new accounts, edit names and photos, make a caregiver a second administrator, assign caregivers and family to each patient, and print the shift schedule."],
    [SlidersHorizontal, "Set each care plan", "You set the limits.", "For every patient you choose the medicines, exercises, meal and task times, whether regular readings are needed and how often, bowel check days, and the limits that turn a reading amber or red. Strovia never invents a medical limit; you set it."],
    [CalendarClock, "Shifts and visits", "Weekly schedule, home visits.", "Build the weekly shift schedule, including live-in shifts over several days. Visits holds therapist and nurse visits that happen at home, separate from shifts."],
    [Bell, "Alerts and messages", "Phone alerts, staff chat.", "Urgent items reach the care team by phone notification, and you get a weekly summary. Messages is a staff-only chat. Notification emails never contain patient details."],
    [GraduationCap, "Training and certificates", "Assign, review, certify.", "Create a course (upload a document, a quiz in the app, or an in-person session), assign it, review passes and print a certificate. Reminders go out the day before, on the due date, and after it."],
    [ShieldCheck, "Security", "Emailed code, auto sign-out.", "Administrator sign-in needs a 6-digit code sent by email. Profile lists the devices that were remembered, and you can remove any of them. The app signs out after 10 minutes of no use."],
  ],
  relative: [
    [TrendingUp, "Follow recovery", "Score and chart.", "Progress shows a recovery score and a chart built from everyone's daily check-ins, with markers on days when something happened. It also shows how closely the care plan is being followed."],
    [Eye, "See the day", "As it is recorded.", "Today shows the check-in, readings, medicines, meals and exercises as they are recorded, and the handover from the last shift."],
    [BookOpen, "Know the plan", "Care plan, medicines, contacts.", "Care holds the care plan, medicines and exercises, with the emergency information and phone numbers in one place."],
    [CalendarDays, "Schedule", "Visits and appointments.", "Visits and Appointments show who is coming to the home and when, with reminders for appointments."],
    [HeartHandshake, "Help with the check-in", "Proxy can fill it in.", "A family proxy can fill in the daily symptom check-in. Meals are view-only for family, and bowel entries and the staff chat stay with the care team."],
    [Lock, "Your privacy", "Only your person.", "You see only the person you are connected to. Nobody else can see your account, and the app signs out after 10 minutes without use."],
  ],
};

function Flow({ data }) {
  return (
    <div style={{ background: c.card, border: `1px solid ${c.hair}`, borderRadius: 14, padding: "14px 10px 12px", margin: "0 0 14px" }}>
      <p style={{ fontSize: 13.5, color: c.soft, margin: "0 6px 12px", textAlign: "center" }}>{data.line}</p>
      <ol style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 2 }}>
        {data.items.map(([label, Icon, warn]) => (
          <li key={label} style={{ flex: "1 1 0", minWidth: 0, textAlign: "center" }}>
            <span aria-hidden="true" style={{ width: 38, height: 38, borderRadius: 999, margin: "0 auto 5px", display: "flex", alignItems: "center", justifyContent: "center", background: warn ? c.amberTint : c.tint, color: warn ? c.amber : c.deep }}>
              <Icon size={19} />
            </span>
            <span style={{ display: "block", fontSize: 12.5, fontWeight: 600, color: c.ink, lineHeight: 1.2 }}>{label}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}

function Step({ icon: Icon, title, summary, body, open, onToggle, id }) {
  return (
    <section style={{ background: c.card, border: `1px solid ${open ? c.sage : c.hair}`, borderRadius: 14, overflow: "hidden" }}>
      <h2 style={{ margin: 0 }}>
        <button type="button" onClick={onToggle} aria-expanded={open} aria-controls={id}
          style={{ width: "100%", minHeight: 56, display: "flex", alignItems: "center", gap: 12, padding: "10px 14px", border: "none", background: "none", cursor: "pointer", textAlign: "left", font: "inherit" }}>
          <span aria-hidden="true" style={{ flexShrink: 0, width: 36, height: 36, borderRadius: 999, background: c.tint, color: c.deep, display: "flex", alignItems: "center", justifyContent: "center" }}>
            <Icon size={18} />
          </span>
          <span style={{ flex: 1, minWidth: 0 }}>
            <span style={{ display: "block", fontFamily: "Fraunces, serif", fontSize: 16.5, fontWeight: 600, color: c.ink }}>{title}</span>
            <span style={{ display: "block", fontSize: 13.5, color: c.soft, marginTop: 1 }}>{summary}</span>
          </span>
          <ChevronDown size={20} color={c.soft} aria-hidden="true" style={{ flexShrink: 0, transition: "transform 0.15s ease", transform: open ? "rotate(180deg)" : "none" }} />
        </button>
      </h2>
      {open && (
        <p id={id} style={{ fontSize: 14.5, color: c.soft, lineHeight: 1.55, margin: 0, padding: "0 16px 16px 62px" }}>{body}</p>
      )}
    </section>
  );
}

export default function HowItWorks({ role }) {
  const start = role === "admin" ? "admin" : role === "caregiver" ? "caregiver" : "relative";
  const [pick, setPick] = useState(start);
  const [openIx, setOpenIx] = useState(0);
  const steps = STEPS[pick];
  const choose = (k) => { setPick(k); setOpenIx(0); };
  return (
    <div>
      <h1 style={{ fontFamily: "Fraunces, serif", fontSize: 25, fontWeight: 600, color: c.ink, margin: "0 0 6px" }}>How Strovia works</h1>
      <p style={{ fontSize: 14.5, color: c.soft, lineHeight: 1.55, margin: "0 0 14px" }}>{INTRO}</p>

      <div role="tablist" aria-label="Choose an account type" style={{ display: "flex", gap: 6, flexWrap: "wrap", margin: "0 0 12px" }}>
        {ROLES.map((r) => {
          const on = pick === r.key;
          return (
            <button key={r.key} role="tab" aria-selected={on} onClick={() => choose(r.key)}
              style={{ minHeight: 40, padding: "8px 14px", borderRadius: 999, cursor: "pointer", fontSize: 14, fontWeight: 600, border: `1px solid ${on ? c.sage : c.hair}`, background: on ? c.tint : c.card, color: on ? c.deep : c.soft }}>
              {r.label}
            </button>
          );
        })}
      </div>

      <Flow data={FLOW[pick]} />

      <div style={{ display: "grid", gap: 8 }}>
        {steps.map(([icon, title, summary, body], i) => (
          <Step key={pick + title} id={`how-${pick}-${i}`} icon={icon} title={title} summary={summary} body={body}
            open={openIx === i} onToggle={() => setOpenIx(openIx === i ? -1 : i)} />
        ))}
      </div>

      <div style={{ marginTop: 14, background: c.card, border: `1px solid ${c.hair}`, borderRadius: 14, padding: "14px 16px" }}>
        <h2 style={{ fontFamily: "Fraunces, serif", fontSize: 17, fontWeight: 600, color: c.ink, margin: "0 0 8px" }}>What the colours mean</h2>
        <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 6 }}>
          <span style={{ background: c.tint, color: c.deep, fontWeight: 700, fontSize: 13, padding: "3px 10px", borderRadius: 999 }}>Green</span>
          <span style={{ fontSize: 14.5, color: c.soft }}>Done, or nothing to do.</span>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 6 }}>
          <span style={{ background: c.amberTint, color: c.amber, fontWeight: 700, fontSize: 13, padding: "3px 10px", borderRadius: 999 }}>Amber</span>
          <span style={{ fontSize: 14.5, color: c.soft }}>Needs attention soon.</span>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <span style={{ background: c.rustTint, color: c.rust, fontWeight: 700, fontSize: 13, padding: "3px 10px", borderRadius: 999 }}>Red</span>
          <span style={{ fontSize: 14.5, color: c.soft }}>Urgent. Act now.</span>
        </div>
      </div>

      <p style={{ fontSize: 13.5, color: c.soft, lineHeight: 1.5, margin: "14px 2px 0" }}>
        Strovia supports the care team. It does not give medical advice, and in an emergency you should call your local emergency number.
      </p>
    </div>
  );
}
