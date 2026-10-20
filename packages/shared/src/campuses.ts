export interface CampusBranch {
  id: string
  label: string
  city: string
  province: string
  lat: number
  lng: number
}

export interface CampusGroup {
  id: string
  name: string
  shortName: string
  aliases: string[]
  branches: CampusBranch[]
}

const branch = (id: string, label: string, city: string, province: string, lat: number, lng: number): CampusBranch => ({ id, label, city, province, lat, lng })

// Coordinates for the 18 retained ids are carried over from the original campus dataset.
export const CAMPUS_CATALOG: CampusGroup[] = [
  { id:'binus', name:'Universitas Bina Nusantara', shortName:'BINUS', aliases:['binus','bina nusantara','universitas bina nusantara'], branches:[
    branch('binus-syahdan','Kemanggisan - Syahdan','Jakarta','DKI Jakarta',-6.2001,106.7852), branch('binus-anggrek','Kemanggisan - Anggrek','Jakarta','DKI Jakarta',-6.1952,106.7821), branch('binus-kijang','Kemanggisan - Kijang','Jakarta','DKI Jakarta',-6.2081,106.7876), branch('binus-alam-sutera','Alam Sutera','Tangerang','Banten',-6.2248,106.6497), branch('binus-bekasi','Bekasi','Bekasi','Jawa Barat',-6.2231,107.0012), branch('binus-bandung','Bandung','Bandung','Jawa Barat',-6.9147,107.6021), branch('binus-malang','Malang','Malang','Jawa Timur',-7.9366,112.6597), branch('binus-semarang','Semarang','Semarang','Jawa Tengah',-6.9847,110.4092), branch('binus-senayan','Senayan','Jakarta','DKI Jakarta',-6.2243,106.8005),
  ]},
  { id:'ui', name:'Universitas Indonesia', shortName:'UI', aliases:['ui','universitas indonesia'], branches:[branch('ui-depok','Depok','Depok','Jawa Barat',-6.3628,106.8271),branch('ui-salemba','Salemba','Jakarta','DKI Jakarta',-6.1989,106.8501)] },
  { id:'unj', name:'Universitas Negeri Jakarta', shortName:'UNJ', aliases:['unj','universitas negeri jakarta'], branches:[branch('unj-rawamangun','Rawamangun','Jakarta','DKI Jakarta',-6.1921,106.8797)] },
  { id:'trisakti', name:'Universitas Trisakti', shortName:'Trisakti', aliases:['trisakti','universitas trisakti'], branches:[branch('trisakti-grogol','Grogol','Jakarta','DKI Jakarta',-6.1662,106.7901)] },
  { id:'untar', name:'Universitas Tarumanagara', shortName:'Untar', aliases:['untar','tarumanagara','universitas tarumanagara'], branches:[branch('untar-grogol','Grogol','Jakarta','DKI Jakarta',-6.1678,106.790)] },
  { id:'atma-jaya-jakarta', name:'Universitas Katolik Indonesia Atma Jaya', shortName:'Atma Jaya', aliases:['atma jaya jakarta','unika atma jaya','universitas katolik indonesia atma jaya'], branches:[branch('atma-jaya-semanggi','Semanggi','Jakarta','DKI Jakarta',-6.2174,106.803),branch('atma-jaya-bsd','BSD','Tangerang','Banten',-6.3021,106.652)] },
  { id:'mercu-buana', name:'Universitas Mercu Buana', shortName:'Mercu Buana', aliases:['mercu buana','universitas mercu buana'], branches:[branch('mercu-buana-meruya','Meruya','Jakarta','DKI Jakarta',-6.201,106.739),branch('mercu-buana-menteng','Menteng','Jakarta','DKI Jakarta',-6.194,106.832)] },
  { id:'gunadarma', name:'Universitas Gunadarma', shortName:'Gunadarma', aliases:['gunadarma','universitas gunadarma'], branches:[branch('gunadarma-depok','Depok','Depok','Jawa Barat',-6.368,106.833),branch('gunadarma-kalimalang','Kalimalang','Jakarta','DKI Jakarta',-6.247,106.96),branch('gunadarma-karawaci','Karawaci','Tangerang','Banten',-6.223,106.631),branch('gunadarma-salemba','Salemba','Jakarta','DKI Jakarta',-6.199,106.850)] },
  { id:'umn', name:'Universitas Multimedia Nusantara', shortName:'UMN', aliases:['umn','universitas multimedia nusantara'], branches:[branch('umn-gading-serpong','Gading Serpong','Tangerang','Banten',-6.2577,106.6182)] },
  { id:'pradita', name:'Universitas Pradita', shortName:'Pradita', aliases:['pradita','universitas pradita'], branches:[branch('pradita-gading-serpong','Gading Serpong','Tangerang','Banten',-6.241,106.629)] },
  { id:'prasetiya-mulya', name:'Universitas Prasetiya Mulya', shortName:'Prasetiya Mulya', aliases:['prasetiya mulya','prasmul'], branches:[branch('prasetiya-mulya-bsd','BSD','Tangerang','Banten',-6.303,106.641)] },
  { id:'uph', name:'Universitas Pelita Harapan', shortName:'UPH', aliases:['uph','universitas pelita harapan'], branches:[branch('uph-lippo-karawaci','Lippo Karawaci','Tangerang','Banten',-6.227,106.631)] },
  { id:'pancasila', name:'Universitas Pancasila', shortName:'UP', aliases:['universitas pancasila'], branches:[branch('pancasila-srengseng-sawah','Srengseng Sawah','Jakarta','DKI Jakarta',-6.335,106.832)] },
  { id:'esa-unggul', name:'Universitas Esa Unggul', shortName:'Esa Unggul', aliases:['esa unggul','universitas esa unggul'], branches:[branch('esa-unggul-kebon-jeruk','Kebon Jeruk','Jakarta','DKI Jakarta',-6.188,106.773)] },
  { id:'budi-luhur', name:'Universitas Budi Luhur', shortName:'Budi Luhur', aliases:['budi luhur','universitas budi luhur'], branches:[branch('budi-luhur-petukangan','Petukangan','Jakarta','DKI Jakarta',-6.234,106.751)] },
  { id:'uin-jakarta', name:'UIN Syarif Hidayatullah Jakarta', shortName:'UIN Jakarta', aliases:['uin jakarta','uin syarif hidayatullah','syarif hidayatullah'], branches:[branch('uin-jakarta-ciputat','Ciputat','Tangerang Selatan','Banten',-6.306,106.753)] },
  { id:'bakrie', name:'Universitas Bakrie', shortName:'Bakrie', aliases:['bakrie','universitas bakrie'], branches:[branch('bakrie-rasuna-said','Rasuna Said','Jakarta','DKI Jakarta',-6.218,106.832)] },
  { id:'pkn-stan', name:'Politeknik Keuangan Negara STAN', shortName:'PKN STAN', aliases:['pkn stan','stan'], branches:[branch('pkn-stan-bintaro','Bintaro','Tangerang Selatan','Banten',-6.268,106.734)] },
  { id:'president-university', name:'President University', shortName:'President University', aliases:['president university','presuniv'], branches:[branch('president-university','Jababeka','Bekasi','Jawa Barat',-6.2856,107.1707)] },
  { id:'untirta', name:'Universitas Sultan Ageng Tirtayasa', shortName:'Untirta', aliases:['untirta','sultan ageng tirtayasa'], branches:[branch('untirta-serang','Sindangsari','Serang','Banten',-6.1905,106.1245),branch('untirta-serang-kota','Serang Kota','Serang','Banten',-6.112,106.15),branch('untirta-cilegon','Cilegon','Cilegon','Banten',-6.016,106.053)] },
  { id:'itb', name:'Institut Teknologi Bandung', shortName:'ITB', aliases:['itb','institut teknologi bandung'], branches:[branch('itb-ganesha','Ganesha','Bandung','Jawa Barat',-6.8915,107.6107)] },
  { id:'ipb', name:'IPB University', shortName:'IPB', aliases:['ipb','ipb university','institut pertanian bogor'], branches:[branch('ipb-dramaga','Dramaga','Bogor','Jawa Barat',-6.5553,106.725),branch('ipb-baranangsiang','Baranangsiang','Bogor','Jawa Barat',-6.606,106.806)] },
  { id:'unpad', name:'Universitas Padjadjaran', shortName:'UNPAD', aliases:['unpad','universitas padjadjaran','padjadjaran'], branches:[branch('unpad-dipati-ukur','Dipati Ukur','Bandung','Jawa Barat',-6.893,107.618),branch('unpad-jatinangor','Jatinangor','Sumedang','Jawa Barat',-6.926,107.772)] },
  { id:'upi', name:'Universitas Pendidikan Indonesia', shortName:'UPI', aliases:['upi','universitas pendidikan indonesia'], branches:[branch('upi-setiabudi','Setiabudi','Bandung','Jawa Barat',-6.861,107.592)] },
  { id:'telkom', name:'Telkom University', shortName:'Tel-U', aliases:['telkom','telkom university','tel-u','universitas telkom','teknologi telkom'], branches:[branch('telkom-bojongsoang','Bojongsoang','Bandung','Jawa Barat',-6.974,107.631)] },
  { id:'unpar', name:'Universitas Katolik Parahyangan', shortName:'Unpar', aliases:['unpar','parahyangan'], branches:[branch('unpar-ciumbuleuit','Ciumbuleuit','Bandung','Jawa Barat',-6.873,107.604)] },
  { id:'maranatha', name:'Universitas Kristen Maranatha', shortName:'Maranatha', aliases:['maranatha','universitas kristen maranatha'], branches:[branch('maranatha-sukawarna','Sukawarna','Bandung','Jawa Barat',-6.886,107.579)] },
  { id:'itenas', name:'Institut Teknologi Nasional Bandung', shortName:'Itenas', aliases:['itenas','institut teknologi nasional bandung'], branches:[branch('itenas-cikutra','Cikutra','Bandung','Jawa Barat',-6.898,107.636)] },
  { id:'uin-bandung', name:'UIN Sunan Gunung Djati Bandung', shortName:'UIN Bandung', aliases:['uin bandung','uin sunan gunung djati','sunan gunung djati'], branches:[branch('uin-bandung-cibiru','Cibiru','Bandung','Jawa Barat',-6.93,107.716)] },
  { id:'unsil', name:'Universitas Siliwangi', shortName:'Unsil', aliases:['unsil','universitas siliwangi'], branches:[branch('unsil-tasikmalaya','Tasikmalaya','Tasikmalaya','Jawa Barat',-7.349,108.2228)] },
  { id:'unswagati', name:'Universitas Swadaya Gunung Jati', shortName:'Unswagati', aliases:['unswagati','universitas swadaya gunung jati','ugj'], branches:[branch('unswagati-cirebon','Cirebon','Cirebon','Jawa Barat',-6.732,108.552)] },
  { id:'undip', name:'Universitas Diponegoro', shortName:'Undip', aliases:['undip','universitas diponegoro'], branches:[branch('undip-tembalang','Tembalang','Semarang','Jawa Tengah',-7.0516,110.4395),branch('undip-pleburan','Pleburan','Semarang','Jawa Tengah',-6.99,110.422)] },
  { id:'unnes', name:'Universitas Negeri Semarang', shortName:'UNNES', aliases:['unnes','universitas negeri semarang'], branches:[branch('unnes-sekaran','Sekaran','Semarang','Jawa Tengah',-7.051,110.394)] },
  { id:'uns', name:'Universitas Sebelas Maret', shortName:'UNS', aliases:['uns','universitas sebelas maret'], branches:[branch('uns-kentingan','Kentingan','Surakarta','Jawa Tengah',-7.5599,110.857),branch('uns-pabelan','Pabelan','Sukoharjo','Jawa Tengah',-7.562,110.771)] },
  { id:'unsoed', name:'Universitas Jenderal Soedirman', shortName:'Unsoed', aliases:['unsoed','jenderal soedirman'], branches:[branch('unsoed-purwokerto','Grendeng','Purwokerto','Jawa Tengah',-7.404,109.246)] },
  { id:'uksw', name:'Universitas Kristen Satya Wacana', shortName:'UKSW', aliases:['uksw','satya wacana'], branches:[branch('uksw-salatiga','Salatiga','Salatiga','Jawa Tengah',-7.319,110.4995)] },
  { id:'ugm', name:'Universitas Gadjah Mada', shortName:'UGM', aliases:['ugm','gadjah mada','gajah mada','universitas gadjah mada'], branches:[branch('ugm-bulaksumur','Bulaksumur','Yogyakarta','DI Yogyakarta',-7.7704,110.3778)] },
  { id:'uny', name:'Universitas Negeri Yogyakarta', shortName:'UNY', aliases:['uny','universitas negeri yogyakarta'], branches:[branch('uny-karangmalang','Karangmalang','Yogyakarta','DI Yogyakarta',-7.772,110.386)] },
  { id:'uin-suka', name:'UIN Sunan Kalijaga Yogyakarta', shortName:'UIN Suka', aliases:['uin suka','uin sunan kalijaga','sunan kalijaga'], branches:[branch('uin-suka-caturtunggal','Caturtunggal','Yogyakarta','DI Yogyakarta',-7.783,110.394)] },
  { id:'uii', name:'Universitas Islam Indonesia', shortName:'UII', aliases:['uii','universitas islam indonesia'], branches:[branch('uii-terpadu','Kampus Terpadu','Sleman','DI Yogyakarta',-7.687,110.414)] },
  { id:'umy', name:'Universitas Muhammadiyah Yogyakarta', shortName:'UMY', aliases:['umy','universitas muhammadiyah yogyakarta'], branches:[branch('umy-kasihan','Kasihan','Bantul','DI Yogyakarta',-7.81,110.319)] },
  { id:'uajy', name:'Universitas Atma Jaya Yogyakarta', shortName:'UAJY', aliases:['uajy','atma jaya yogyakarta'], branches:[branch('uajy-babarsari','Babarsari','Sleman','DI Yogyakarta',-7.779,110.416)] },
  { id:'ukdw', name:'Universitas Kristen Duta Wacana', shortName:'UKDW', aliases:['ukdw','duta wacana'], branches:[branch('ukdw-yogyakarta','Yogyakarta','Yogyakarta','DI Yogyakarta',-7.782,110.378)] },
  { id:'usd', name:'Universitas Sanata Dharma', shortName:'Sanata Dharma', aliases:['usd','sanata dharma'], branches:[branch('usd-mrican','Mrican','Yogyakarta','DI Yogyakarta',-7.78,110.39),branch('usd-paingan','Paingan','Sleman','DI Yogyakarta',-7.75,110.413)] },
  { id:'unika-semarang', name:'Universitas Katolik Soegijapranata', shortName:'Unika Soegijapranata', aliases:['unika soegijapranata','soegijapranata'], branches:[branch('unika-semarang-bendan','Bendan','Semarang','Jawa Tengah',-7.024,110.395)] },
  { id:'udinus', name:'Universitas Dian Nuswantoro', shortName:'Udinus', aliases:['udinus','dian nuswantoro'], branches:[branch('udinus-semarang','Semarang','Semarang','Jawa Tengah',-6.982,110.409)] },
  { id:'unissula', name:'Universitas Islam Sultan Agung', shortName:'Unissula', aliases:['unissula','sultan agung'], branches:[branch('unissula-terboyo','Terboyo','Semarang','Jawa Tengah',-6.95,110.459)] },
  { id:'its', name:'Institut Teknologi Sepuluh Nopember', shortName:'ITS', aliases:['its','institut teknologi sepuluh nopember'], branches:[branch('its-sukolilo','Sukolilo','Surabaya','Jawa Timur',-7.2827,112.7957)] },
  { id:'unair', name:'Universitas Airlangga', shortName:'Unair', aliases:['unair','universitas airlangga','ãœnair'], branches:[branch('unair-kampus-a','Kampus A','Surabaya','Jawa Timur',-7.267,112.758),branch('unair-kampus-b','Kampus B','Surabaya','Jawa Timur',-7.265,112.759),branch('unair-kampus-c','Kampus C','Surabaya','Jawa Timur',-7.269,112.783)] },
  { id:'unesa', name:'Universitas Negeri Surabaya', shortName:'UNESA', aliases:['unesa','universitas negeri surabaya'], branches:[branch('unesa-ketintang','Ketintang','Surabaya','Jawa Timur',-7.312,112.726),branch('unesa-lidah-wetan','Lidah Wetan','Surabaya','Jawa Timur',-7.301,112.667)] },
  { id:'ub', name:'Universitas Brawijaya', shortName:'UB', aliases:['ub','universitas brawijaya'], branches:[branch('ub-malang','Veteran','Malang','Jawa Timur',-7.9518,112.6138)] },
  { id:'um', name:'Universitas Negeri Malang', shortName:'UM', aliases:['um','universitas negeri malang'], branches:[branch('um-malang','Malang','Malang','Jawa Timur',-7.961,112.617)] },
  { id:'uin-malang', name:'UIN Maulana Malik Ibrahim Malang', shortName:'UIN Malang', aliases:['uin malang','uin maulana malik ibrahim'], branches:[branch('uin-malang-gajayana','Gajayana','Malang','Jawa Timur',-7.951,112.607)] },
  { id:'umm', name:'Universitas Muhammadiyah Malang', shortName:'UMM', aliases:['umm','universitas muhammadiyah malang'], branches:[branch('umm-malang','Malang','Malang','Jawa Timur',-7.921,112.598)] },
  { id:'unej', name:'Universitas Jember', shortName:'Unej', aliases:['unej','universitas jember'], branches:[branch('unej-jember','Tegalboto','Jember','Jawa Timur',-8.1646,113.7155)] },
  { id:'petra', name:'Universitas Kristen Petra', shortName:'Petra', aliases:['petra','universitas kristen petra'], branches:[branch('petra-siwalankerto','Siwalankerto','Surabaya','Jawa Timur',-7.339,112.737)] },
  { id:'ubaya', name:'Universitas Surabaya', shortName:'Ubaya', aliases:['ubaya','universitas surabaya'], branches:[branch('ubaya-tenggilis','Tenggilis','Surabaya','Jawa Timur',-7.322,112.768)] },
  { id:'unmer-malang', name:'Universitas Merdeka Malang', shortName:'Unmer', aliases:['unmer malang','universitas merdeka malang'], branches:[branch('unmer-malang','Malang','Malang','Jawa Timur',-7.976,112.622)] },
  { id:'upn-veteran-jakarta', name:'Universitas Pembangunan Nasional Veteran Jakarta', shortName:'UPN Veteran Jakarta', aliases:['upn veteran jakarta','upn jakarta','universitas pembangunan nasional veteran jakarta'], branches:[branch('upn-veteran-jakarta-pondok-labu','Pondok Labu','Jakarta','DKI Jakarta',-6.312,106.779),branch('upn-veteran-jakarta-limo','Limo','Depok','Jawa Barat',-6.356,106.766)] },
  { id:'upn-veteran-yogyakarta', name:'Universitas Pembangunan Nasional Veteran Yogyakarta', shortName:'UPN Veteran Yogyakarta', aliases:['upn veteran yogyakarta','upn yogyakarta'], branches:[branch('upn-veteran-yogyakarta-condongcatur','Condongcatur','Sleman','DI Yogyakarta',-7.765,110.409)] },
  { id:'upn-veteran-jatim', name:'Universitas Pembangunan Nasional Veteran Jawa Timur', shortName:'UPN Veteran Jatim', aliases:['upn veteran jatim','upn veteran jawa timur','upn surabaya'], branches:[branch('upn-veteran-jatim-rungkut','Rungkut','Surabaya','Jawa Timur',-7.333,112.788)] },
  { id:'unsika', name:'Universitas Singaperbangsa Karawang', shortName:'Unsika', aliases:['unsika','universitas singaperbangsa karawang'], branches:[branch('unsika-telukjambe','Telukjambe','Karawang','Jawa Barat',-6.322,107.303)] },
  { id:'untidar', name:'Universitas Tidar', shortName:'Untidar', aliases:['untidar','universitas tidar'], branches:[branch('untidar-magelang','Magelang','Magelang','Jawa Tengah',-7.479,110.218)] },
  { id:'utm', name:'Universitas Trunojoyo Madura', shortName:'UTM', aliases:['utm','universitas trunojoyo madura'], branches:[branch('utm-kamal','Kamal','Bangkalan','Jawa Timur',-7.049,112.736)] },
  { id:'uin-sunan-ampel', name:'UIN Sunan Ampel Surabaya', shortName:'UINSA', aliases:['uinsa','uin sunan ampel','sunan ampel'], branches:[branch('uin-sunan-ampel-wonocolo','Wonocolo','Surabaya','Jawa Timur',-7.336,112.735)] },
  { id:'uin-walisongo', name:'UIN Walisongo Semarang', shortName:'UIN Walisongo', aliases:['uin walisongo','walisongo'], branches:[branch('uin-walisongo-ngaliyan','Ngaliyan','Semarang','Jawa Tengah',-6.999,110.336)] },
  { id:'uin-raden-mas-said', name:'UIN Raden Mas Said Surakarta', shortName:'UIN RMS', aliases:['uin raden mas said','uin surakarta'], branches:[branch('uin-raden-mas-said-pabelan','Pabelan','Sukoharjo','Jawa Tengah',-7.558,110.77)] },
  { id:'polinema', name:'Politeknik Negeri Malang', shortName:'Polinema', aliases:['polinema','politeknik negeri malang'], branches:[branch('polinema-lowokwaru','Lowokwaru','Malang','Jawa Timur',-7.946,112.615)] },
  { id:'pens', name:'Politeknik Elektronika Negeri Surabaya', shortName:'PENS', aliases:['pens','politeknik elektronika negeri surabaya'], branches:[branch('pens-sukolilo','Sukolilo','Surabaya','Jawa Timur',-7.276,112.793)] },
  { id:'polban', name:'Politeknik Negeri Bandung', shortName:'Polban', aliases:['polban','politeknik negeri bandung'], branches:[branch('polban-ciwaruga','Ciwaruga','Bandung Barat','Jawa Barat',-6.872,107.574)] },
  { id:'pnj', name:'Politeknik Negeri Jakarta', shortName:'PNJ', aliases:['pnj','politeknik negeri jakarta'], branches:[branch('pnj-kukusan','Kukusan','Depok','Jawa Barat',-6.371,106.824)] },
  { id:'polines', name:'Politeknik Negeri Semarang', shortName:'Polines', aliases:['polines','politeknik negeri semarang'], branches:[branch('polines-tembalang','Tembalang','Semarang','Jawa Tengah',-7.052,110.433)] },
  { id:'polije', name:'Politeknik Negeri Jember', shortName:'Polije', aliases:['polije','politeknik negeri jember'], branches:[branch('polije-jember','Jember','Jember','Jawa Timur',-8.158,113.722)] },
]

export interface CampusSuggestion {
  group: CampusGroup
  branch: CampusBranch
}

export const normalizeCampusText = (text: string): string => text.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, ' ').trim().replace(/\s+/g, ' ')

const branchIndex = new Map(CAMPUS_CATALOG.flatMap((group) => group.branches.map((item) => [item.id, { group, branch: item }] as const)))
export const branchById = (id: string): CampusBranch | undefined => branchIndex.get(id)?.branch
export const groupOfBranch = (id: string): CampusGroup | undefined => branchIndex.get(id)?.group

export function searchCampuses(query: string, catalog: CampusGroup[] = CAMPUS_CATALOG): CampusSuggestion[] {
  const q = normalizeCampusText(query)
  if (!q) return []
  if (q.length === 1 && !catalog.some((group) => group.aliases.some((alias) => normalizeCampusText(alias) === q))) return []
  const exactShortGroup = catalog.find((group) => q.length <= 3 && (
    group.aliases.some((alias) => normalizeCampusText(alias) === q) || normalizeCampusText(group.shortName) === q
  ))
  if (exactShortGroup) return exactShortGroup.branches.map((item) => ({ group: exactShortGroup, branch: item }))
  const rows: Array<{ rank: number; groupIndex: number; branchIndex: number; value: CampusSuggestion }> = []
  catalog.forEach((group, groupIndex) => {
    const aliases = group.aliases.map(normalizeCampusText)
    const names = [normalizeCampusText(group.name), normalizeCampusText(group.shortName)]
    const groupExact = aliases.includes(q) || names.includes(q)
    const starts = [...aliases, ...names].some((key) => key.startsWith(q) && (q.length > 3 || key === q || key.startsWith(`${q} `)))
    const wordPrefix = [...normalizeCampusText(group.name).split(' '), ...normalizeCampusText(group.shortName).split(' ')].some((word) => word.startsWith(q))
    const groupRank = groupExact ? 0 : starts ? 1 : wordPrefix ? 2 : q.length >= 4 && [...aliases, ...names].some((key) => key.includes(q)) ? 3 : 99
    const branchHits = q.length >= 4 ? group.branches.filter((b) => [b.label, b.city].some((v) => normalizeCampusText(v).includes(q))) : []
    const branches = groupRank < 99 ? group.branches : branchHits
    const rank = groupRank < 99 ? groupRank : (q.length >= 4 ? 4 : 99)
    branches.forEach((item) => rows.push({ rank, groupIndex, branchIndex: group.branches.indexOf(item), value: { group, branch: item } }))
  })
  const sorted = rows.sort((a, b) => a.rank - b.rank || a.groupIndex - b.groupIndex || a.branchIndex - b.branchIndex)
  const exactGroup = sorted.find(({ value }) => value.group.aliases.some((alias) => normalizeCampusText(alias) === q))?.value.group
  const exactGroupRows = exactGroup && exactGroup.branches.length > 8 && exactGroup.aliases.some((alias) => normalizeCampusText(alias) === q)
    ? sorted.filter(({ value }) => value.group.id === exactGroup.id)
    : []
  return (exactGroupRows.length ? exactGroupRows : sorted.slice(0, 8)).map((r) => r.value)
}
