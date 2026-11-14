/**
 * The register the assistant answers procedure questions from.
 * Content comes from the schools' pages (data/aui_departments_faculty.json → services) except
 * where marked draft. Nothing here is "live" until the admin reviews it; the app shows an
 * unverified banner for draft/review entries.
 */
export type ProcedureSeed = {
  id: string; title: string; summary: string; owner_office: string; place_id: string | null; contact_email: string | null;
  steps: { title: string; body: string }[]; match_phrases: string[]; source: string; status: 'draft' | 'review' | 'live'; verified_at: string | null;
};

export function procedureSeeds(retrievedOn: string): ProcedureSeed[] {
  return [
    {
      id: 'declare-minor', title: 'Declare a minor', owner_office: 'Registrar (Registration Office)', place_id: 'building-1', contact_email: 's.moujahid@aui.ma',
      summary: 'You declare or change a minor at the Registrar (Building 1, ext. 2175), after your academic advisor signs the declaration form.',
      steps: [
        { title: 'Talk to your advisor', body: 'Check the minor fits your degree plan and get the declaration form signed.' },
        { title: 'Get the minor coordinator to sign', body: 'The school that runs the minor signs the form too.' },
        { title: 'Hand it in at the Registrar', body: 'Bring the signed form to Building 1, Monday to Friday 9:00–17:30 (closed 13:00–14:00).' },
      ],
      match_phrases: ['declare a minor', 'add a minor', 'change my minor', 'minor declaration', 'how do i get a minor', 'minor form', 'déclarer une mineure', 'mineure'],
      source: `Offices and services list (aui.ma), retrieved ${retrievedOn}; form steps not yet confirmed`, status: 'review', verified_at: retrievedOn,
    },
    {
      id: 'graduation-application', title: 'Apply to graduate (graduation declaration)', owner_office: 'Registrar (Registration Office)', place_id: 'building-1', contact_email: 's.moujahid@aui.ma',
      summary: 'You declare your graduation by filing a graduation application with the Registrar (Building 1), which runs a degree audit to check every requirement is met.',
      steps: [
        { title: 'Check your degree audit', body: 'Review your remaining requirements with your academic advisor the term before you graduate.' },
        { title: 'File the graduation application', body: 'Submit it to the Registrar in Building 1 (ext. 2175) before the deadline in the academic calendar.' },
        { title: 'Clear any holds', body: 'Financial holds block graduation: settle them at the Business Office (Building 1, ext. 2368).' },
      ],
      match_phrases: ['apply to graduate', 'graduation application', 'graduation declaration', 'declare graduation', 'declare my graduation', 'degree audit', 'how do i graduate', 'demande de diplome', 'التخرج'],
      source: `Offices and services list (aui.ma), retrieved ${retrievedOn}; deadline not in our records`, status: 'review', verified_at: retrievedOn,
    },
    {
      id: 'change-major', title: 'Change your major', owner_office: 'Registrar (Registration Office)', place_id: 'building-1', contact_email: 's.moujahid@aui.ma',
      summary: 'Changing major, specialization, concentration or catalog year goes through the Registrar in Building 1, after your advisor agrees.',
      steps: [
        { title: 'Talk to your advisor', body: 'Check how the change affects your degree plan and graduation date.' },
        { title: 'Request the change at the Registrar', body: 'Building 1, ext. 2175, s.moujahid@aui.ma.' },
      ],
      match_phrases: ['change major', 'change my major', 'switch major', 'change specialization', 'change concentration', 'change catalog year', 'changer de majeure'],
      source: `Offices and services list (aui.ma), retrieved ${retrievedOn}`, status: 'review', verified_at: retrievedOn,
    },
    {
      id: 'sba-internship', title: 'SBA internship (INT 4301)', owner_office: 'School of Business Administration', place_id: 'building-11', contact_email: 'm.ettoualy@aui.ma',
      summary: 'The SBA internship (INT 4301) is mandatory for graduation. You need an internship agreement (convention de stage) signed before you start, then a report and a presentation.',
      steps: [
        { title: 'Find a host organisation', body: 'Pathways (Employability & Entrepreneurship Office) can help with leads.' },
        { title: 'Get the internship agreement signed', body: 'The convention de stage is signed by you, the host and the school before the start date.' },
        { title: 'Register INT 4301', body: 'Register the internship course for the term you do it in.' },
        { title: 'Report and presentation', body: 'Follow the school\'s report and presentation guidelines at the end of the internship.' },
      ],
      match_phrases: ['sba internship', 'int 4301', 'internship agreement', 'convention de stage', 'internship signature', 'sign my internship', 'business internship', 'stage'],
      source: `School of Business Administration page (aui.ma), retrieved ${retrievedOn}`, status: 'review', verified_at: retrievedOn,
    },
    {
      id: 'ssah-internship', title: 'SSAH internship (INT 4300)', owner_office: 'School of Social Sciences, Arts and Humanities', place_id: 'building-8', contact_email: null,
      summary: 'INT 4300 is required for all SSAH students. Start with your academic advisor, then get the internship agreement signed before you begin.',
      steps: [
        { title: 'Talk to your advisor', body: 'Confirm timing and eligibility for INT 4300.' },
        { title: 'Internship agreement', body: 'Have the convention de stage signed before the start date.' },
        { title: 'Register INT 4300', body: 'Register the course for the term of the internship.' },
      ],
      match_phrases: ['ssah internship', 'int 4300', 'humanities internship', 'shss internship'],
      source: `SSAH page (aui.ma), retrieved ${retrievedOn}`, status: 'review', verified_at: retrievedOn,
    },
    {
      id: 'sse-capstone-internship', title: 'SSE capstone and internship', owner_office: 'School of Science and Engineering', place_id: 'building-5', contact_email: 'h.bourjila@aui.ma',
      summary: "SSE capstone design projects and internships are coordinated by the school. Conventions de stage with employers go through SSE student affairs in Building 5.",
      steps: [
        { title: 'Agree the project or internship', body: 'With your capstone supervisor or the employer.' },
        { title: 'Convention de stage', body: 'Bring the employer agreement to SSE student affairs (Building 5, Office 9).' },
      ],
      match_phrases: ['capstone', 'sse internship', 'engineering internship', 'science internship'],
      source: `SSE page (aui.ma), retrieved ${retrievedOn}`, status: 'review', verified_at: retrievedOn,
    },
    {
      id: 'academic-advising', title: 'Academic advising and course approval', owner_office: 'Your school', place_id: null, contact_email: null,
      summary: 'Every student has an academic advisor who approves the degree plan and course registration. In SSE, each course also needs the coordinator\'s approval.',
      steps: [
        { title: 'Find your advisor', body: 'Your advisor is listed in your student account. SBA students can also ask the academic advisor in Building 10, Office 11.' },
        { title: 'Plan your courses', body: 'Bring your program sheet and proposed schedule.' },
        { title: 'Get approval', body: 'Your advisor approves the courses before registration.' },
      ],
      match_phrases: ['academic advisor', 'advising', 'who is my advisor', 'course approval', 'pre-registration', 'preregistration', 'register for courses', 'degree plan'],
      source: `School pages (aui.ma), retrieved ${retrievedOn}`, status: 'review', verified_at: retrievedOn,
    },
    {
      id: 'it-account', title: 'Wi-Fi or campus account problems', owner_office: 'Information Technologies and Services (ITS)', place_id: 'building-9', contact_email: 'its@aui.ma',
      summary: 'ITS (Building 9, ext. 2404) handles passwords, email, Wi-Fi, Canvas and portal access.',
      steps: [{ title: 'Go to ITS in Building 9', body: 'Bring your student or staff ID. Monday to Friday 9:00–17:30, closed 13:00–14:00.' }],
      match_phrases: ['wifi', 'wi-fi', 'password', 'reset my password', 'campus account', 'internet not working', 'email account', 'واي فاي', 'الانترنت'],
      source: `Offices and services list (aui.ma), retrieved ${retrievedOn}`, status: 'review', verified_at: retrievedOn,
    },
    {
      id: 'writing-help', title: 'Writing and tutoring help', owner_office: 'Center for Learning Excellence (CLE)', place_id: 'building-7', contact_email: 'wcenter@aui.ma',
      summary: 'The Writing Center (part of the CLE) offers Socratic-style writing tutoring for all levels; the CLE also runs tutoring and academic support.',
      steps: [{ title: 'Book a session', body: 'The Writing Center (ext. 3288) and the CLE (ext. 4357) are both in Building 7.' }],
      match_phrases: ['writing center', 'tutoring', 'tutor', 'essay help', 'cle'],
      source: `University centres list (aui.ma), retrieved ${retrievedOn}`, status: 'review', verified_at: retrievedOn,
    },
  ];
}
