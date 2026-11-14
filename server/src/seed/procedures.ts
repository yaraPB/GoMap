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
      id: 'declare-minor', title: 'Declare a minor', owner_office: "Registrar's Office", place_id: 'building-2', contact_email: 'registrar@aui.ma',
      summary: "You declare a minor through the Registrar's Office, after your academic advisor signs the declaration form.",
      steps: [
        { title: 'Talk to your advisor', body: 'Check the minor fits your degree plan and get the declaration form signed.' },
        { title: 'Get the minor coordinator to sign', body: 'The school that runs the minor signs the form too.' },
        { title: "Hand it in at the Registrar's Office", body: 'Bring the signed form to Building 2 during office hours.' },
      ],
      match_phrases: ['declare a minor', 'add a minor', 'minor declaration', 'how do i get a minor', 'minor form', 'déclarer une mineure', 'mineure'],
      source: 'Design brief example — office, building and email not yet confirmed', status: 'draft', verified_at: null,
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
      id: 'it-account', title: 'Wi-Fi or campus account problems', owner_office: 'ITS', place_id: 'its', contact_email: null,
      summary: 'ITS handles campus accounts, passwords and Wi-Fi access.',
      steps: [{ title: 'Go to ITS', body: 'Bring your student or staff ID.' }],
      match_phrases: ['wifi', 'wi-fi', 'password', 'reset my password', 'campus account', 'internet not working', 'email account', 'واي فاي', 'الانترنت'],
      source: 'Map label "ITS"; process not confirmed', status: 'draft', verified_at: null,
    },
    {
      id: 'writing-help', title: 'Writing and tutoring help', owner_office: 'Center for Learning Excellence (CLE)', place_id: null, contact_email: null,
      summary: 'The Writing Center (part of the CLE) offers Socratic-style writing tutoring for all levels; the CLE also runs tutoring and academic support.',
      steps: [{ title: 'Book a session', body: 'Contact the Center for Learning Excellence. Its location is not in our map data yet.' }],
      match_phrases: ['writing center', 'tutoring', 'tutor', 'essay help', 'cle'],
      source: `University centres list (aui.ma), retrieved ${retrievedOn}`, status: 'review', verified_at: retrievedOn,
    },
  ];
}
