/** Departments and roles. Codes are stored in the database; labels are shown. */
const departments = [
  {
    code: 'camera', label: 'Camera', roles: [
      ['dop', 'Director of Photography'], ['camera_operator', 'Camera Operator'],
      ['first_ac', '1st Assistant Camera'], ['second_ac', '2nd Assistant Camera'],
      ['dit', 'DIT'], ['steadicam', 'Steadicam Operator'], ['drone_operator', 'Drone Operator'],
    ],
  },
  {
    code: 'grip', label: 'Grip', roles: [
      ['key_grip', 'Key Grip'], ['best_boy_grip', 'Best Boy Grip'],
      ['dolly_grip', 'Dolly Grip'], ['grip', 'Grip'],
    ],
  },
  {
    code: 'electric', label: 'Electric', roles: [
      ['gaffer', 'Gaffer'], ['best_boy_electric', 'Best Boy Electric'],
      ['electrician', 'Electrician'], ['genny_operator', 'Generator Operator'],
      ['board_operator', 'Lighting Board Operator'],
    ],
  },
  {
    code: 'sound', label: 'Sound', roles: [
      ['sound_mixer', 'Production Sound Mixer'], ['boom_operator', 'Boom Operator'],
      ['sound_utility', 'Sound Utility'],
    ],
  },
  {
    code: 'art', label: 'Art', roles: [
      ['production_designer', 'Production Designer'], ['art_director', 'Art Director'],
      ['set_decorator', 'Set Decorator'], ['props_master', 'Props Master'],
      ['set_dresser', 'Set Dresser'], ['scenic_painter', 'Scenic Painter'],
    ],
  },
  {
    code: 'costume_hmu', label: 'Costume, Hair & Makeup', roles: [
      ['costume_designer', 'Costume Designer'], ['wardrobe_supervisor', 'Wardrobe Supervisor'],
      ['key_makeup', 'Key Makeup Artist'], ['key_hair', 'Key Hair Stylist'],
      ['sfx_makeup', 'SFX Makeup Artist'],
    ],
  },
  {
    code: 'production', label: 'Production', roles: [
      ['line_producer', 'Line Producer'], ['production_manager', 'Production Manager'],
      ['production_coordinator', 'Production Coordinator'], ['first_ad', '1st Assistant Director'],
      ['second_ad', '2nd Assistant Director'], ['script_supervisor', 'Script Supervisor'],
      ['location_manager', 'Location Manager'], ['production_assistant', 'Production Assistant'],
    ],
  },
  {
    code: 'post', label: 'Post-production', roles: [
      ['editor', 'Editor'], ['assistant_editor', 'Assistant Editor'], ['colorist', 'Colorist'],
      ['sound_designer', 'Sound Designer'], ['rerecording_mixer', 'Re-recording Mixer'],
      ['vfx_artist', 'VFX Artist'], ['motion_graphics', 'Motion Graphics Designer'],
    ],
  },
];

const roles = {};
for (const dept of departments) {
  dept.roles = dept.roles.map(([code, label]) => ({ code, label, department: dept.code }));
  for (const role of dept.roles) roles[role.code] = role;
}

function roleLabel(code) {
  return roles[code] ? roles[code].label : code;
}

function departmentOf(code) {
  return roles[code] ? roles[code].department : null;
}

function departmentLabel(code) {
  const dept = departments.find((d) => d.code === code);
  return dept ? dept.label : code;
}

module.exports = { departments, roles, roleLabel, departmentOf, departmentLabel };
