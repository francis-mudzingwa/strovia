// Sample patient. Clinical fields come from record id 9046 of the public Kaggle
// "Stroke Prediction Dataset" (fedesoriano), which has stroke = 1. The dataset is
// anonymised, so the name, address, dates and phone numbers below are fictional.
export const DATASET_RECORD = {
  id: 9046,
  gender: "Male",
  age: 67,
  hypertension: 0,
  heart_disease: 1,
  ever_married: "Yes",
  work_type: "Private",
  Residence_type: "Urban",
  avg_glucose_level: 228.69,
  bmi: 36.6,
  smoking_status: "formerly smoked",
  stroke: 1,
}

export const DATASET_SOURCE = "Kaggle Stroke Prediction Dataset (fedesoriano), record id 9046"

export const emptyProfile = () => ({
  fullName: "", dob: "", phone: "", strokeType: "Not sure", strokeDate: "",
  emergencyName: "", emergencyRelationship: "", emergencyPhone: "", careProvider: "",
  recoveryGoals: [],
})

export function buildDemoProfile() {
  return {
    fullName: "Walter Bennett",
    dob: "1959-03-14",
    phone: "(508) 555-0123",
    strokeType: "Ischemic",
    strokeDate: "2026-08-10",
    emergencyName: "Margaret Bennett",
    emergencyRelationship: "Spouse",
    emergencyPhone: "(508) 555-0177",
    careProvider: "Dr. Priya Raman, Neurology",
    recoveryGoals: [
      "Walk safely with a cane",
      "Regain strength in the affected arm",
      "Speak clearly and be easily understood",
      "Keep blood sugar and blood pressure in range",
    ],
    address: "214 Maple Grove Lane, Worcester, MA 01602",
    livesWith: "Wife (Margaret)",
    gender: DATASET_RECORD.gender,
    maritalStatus: DATASET_RECORD.ever_married === "Yes" ? "Married" : "Single",
    workType: "Private sector",
    residence: DATASET_RECORD.Residence_type,
    hypertension: DATASET_RECORD.hypertension === 1,
    heartDisease: DATASET_RECORD.heart_disease === 1,
    avgGlucose: DATASET_RECORD.avg_glucose_level,
    bmi: DATASET_RECORD.bmi,
    smokingStatus: "Formerly smoked",
    sampleRecord: true,
    datasetSource: DATASET_SOURCE,
  }
}
