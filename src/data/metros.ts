/**
 * Curated metro-area presets.
 *
 * Each point is the conventional city-centre of the metro: the place a local means by
 * "downtown" / "the centre" (London: Charing Cross, Paris: Notre-Dame, Tokyo: Tokyo Station,
 * San Jose: Plaza de César Chávez ...). The trailing comment on each row names the exact spot.
 *
 * Kept sorted by `name` (Intl.Collator('en', { sensitivity: 'base' }), ties broken by `context`).
 * Coordinates are WGS84 as mapped in OpenStreetMap (Chinese cities are not GCJ-02 shifted), and every
 * one was cross-checked against the OSM geocoders Photon and Nominatim.
 */

/** A curated metro-area preset. Coordinates are the conventional city-centre point (the place locals mean by "downtown"/"the centre"). */
export interface Metro {
  /** stable kebab-case id, unique, ASCII, e.g. "san-jose", "london", "new-york" */
  id: string;
  /** short display name, e.g. "San Jose", "New York", "São Paulo" */
  name: string;
  /** disambiguating context shown after the name, e.g. "California, USA", "England, UK", "Japan" */
  context: string;
  /** ISO 3166-1 alpha-2 country code, upper case */
  country: string;
  /** WGS84 latitude / longitude of the centre point, 4 decimal places */
  lat: number;
  lng: number;
  /** extra search terms: nicknames, regions, alternate spellings, e.g. ["South Bay", "Silicon Valley", "SJ"] */
  aliases?: readonly string[];
}

export const METROS: readonly Metro[] = [
  { id: 'accra', name: 'Accra', context: 'Ghana', country: 'GH', lat: 5.5481, lng: -0.2069, aliases: ['Tema'] }, // Makola Market, Central Accra
  { id: 'addis-ababa', name: 'Addis Ababa', context: 'Ethiopia', country: 'ET', lat: 9.0106, lng: 38.7615, aliases: ['Addis', 'Addis Abeba', 'Finfinne'] }, // Meskel Square
  { id: 'albuquerque', name: 'Albuquerque', context: 'New Mexico, USA', country: 'US', lat: 35.0844, lng: -106.6504, aliases: ['ABQ', 'Duke City'] }, // Central Ave & 4th St, Downtown
  { id: 'amsterdam', name: 'Amsterdam', context: 'Netherlands', country: 'NL', lat: 52.3731, lng: 4.8926, aliases: ['Randstad', 'Holland'] }, // Dam Square
  { id: 'anchorage', name: 'Anchorage', context: 'Alaska, USA', country: 'US', lat: 61.2171, lng: -149.8925 }, // Town Square Park, Downtown
  { id: 'athens', name: 'Athens', context: 'Greece', country: 'GR', lat: 37.9755, lng: 23.7348, aliases: ['Athina', 'Αθήνα', 'Attica', 'Piraeus'] }, // Syntagma Square
  { id: 'atlanta', name: 'Atlanta', context: 'Georgia, USA', country: 'US', lat: 33.7540, lng: -84.3915, aliases: ['ATL', 'Metro Atlanta'] }, // Five Points
  { id: 'auckland', name: 'Auckland', context: 'New Zealand', country: 'NZ', lat: -36.8523, lng: 174.7633, aliases: ['Tāmaki Makaurau', 'Tamaki Makaurau', 'AKL'] }, // Aotea Square, Queen St
  { id: 'austin', name: 'Austin', context: 'Texas, USA', country: 'US', lat: 30.2682, lng: -97.7429, aliases: ['ATX', 'Round Rock'] }, // Congress Ave & 6th St
  { id: 'baghdad', name: 'Baghdad', context: 'Iraq', country: 'IQ', lat: 33.3277, lng: 44.4087, aliases: ['Bagdad', 'بغداد'] }, // Tahrir Square
  { id: 'baltimore', name: 'Baltimore', context: 'Maryland, USA', country: 'US', lat: 39.2866, lng: -76.6131, aliases: ['Bmore', 'Charm City'] }, // Inner Harbor (Pratt & Light St)
  { id: 'bangkok', name: 'Bangkok', context: 'Thailand', country: 'TH', lat: 13.7456, lng: 100.5341, aliases: ['Krung Thep', 'กรุงเทพ', 'BKK'] }, // Siam
  { id: 'barcelona', name: 'Barcelona', context: 'Catalonia, Spain', country: 'ES', lat: 41.3870, lng: 2.1700, aliases: ['BCN', 'Barna'] }, // Plaça de Catalunya
  { id: 'beijing', name: 'Beijing', context: 'China', country: 'CN', lat: 39.9074, lng: 116.3913, aliases: ['Peking', '北京'] }, // Tiananmen
  { id: 'bengaluru', name: 'Bengaluru', context: 'Karnataka, India', country: 'IN', lat: 12.9796, lng: 77.5906, aliases: ['Bangalore', 'ಬೆಂಗಳೂರು', 'BLR'] }, // Vidhana Soudha
  { id: 'berlin', name: 'Berlin', context: 'Germany', country: 'DE', lat: 52.5163, lng: 13.3777, aliases: ['Potsdam'] }, // Brandenburg Gate
  { id: 'birmingham-al', name: 'Birmingham', context: 'Alabama, USA', country: 'US', lat: 33.5179, lng: -86.8079, aliases: ['Magic City'] }, // Downtown, 20th St N at 5th Ave N
  { id: 'birmingham', name: 'Birmingham', context: 'England, UK', country: 'GB', lat: 52.4796, lng: -1.9030, aliases: ['West Midlands', 'Brum', 'Black Country', 'Wolverhampton', 'Coventry'] }, // Victoria Square
  { id: 'bogota', name: 'Bogotá', context: 'Colombia', country: 'CO', lat: 4.5981, lng: -74.0760, aliases: ['Bogota', 'Santa Fe de Bogotá'] }, // Plaza de Bolívar
  { id: 'boise', name: 'Boise', context: 'Idaho, USA', country: 'US', lat: 43.6160, lng: -116.2030, aliases: ['Treasure Valley', 'Meridian', 'Nampa'] }, // 8th & Main, Downtown
  { id: 'boston', name: 'Boston', context: 'Massachusetts, USA', country: 'US', lat: 42.3564, lng: -71.0624, aliases: ['Greater Boston', 'Cambridge', 'Beantown'] }, // Park Street / Boston Common
  { id: 'brisbane', name: 'Brisbane', context: 'Queensland, Australia', country: 'AU', lat: -27.4684, lng: 153.0240, aliases: ['Brissie', 'Meanjin', 'South East Queensland', 'SEQ'] }, // King George Square
  { id: 'brussels', name: 'Brussels', context: 'Belgium', country: 'BE', lat: 50.8467, lng: 4.3525, aliases: ['Bruxelles', 'Brussel'] }, // Grand-Place
  { id: 'bucharest', name: 'Bucharest', context: 'Romania', country: 'RO', lat: 44.4353, lng: 26.1027, aliases: ['București', 'Bucuresti'] }, // Piața Universității
  { id: 'budapest', name: 'Budapest', context: 'Hungary', country: 'HU', lat: 47.4975, lng: 19.0545, aliases: ['Buda', 'Pest'] }, // Deák Ferenc tér
  { id: 'buenos-aires', name: 'Buenos Aires', context: 'Argentina', country: 'AR', lat: -34.6037, lng: -58.3816, aliases: ['BA', 'CABA', 'Baires', 'Gran Buenos Aires'] }, // Obelisco
  { id: 'buffalo', name: 'Buffalo', context: 'New York, USA', country: 'US', lat: 42.8867, lng: -78.8784, aliases: ['Niagara Falls', 'Western New York'] }, // Niagara Square
  { id: 'busan', name: 'Busan', context: 'South Korea', country: 'KR', lat: 35.1577, lng: 129.0592, aliases: ['Pusan', '부산'] }, // Seomyeon
  { id: 'cairo', name: 'Cairo', context: 'Egypt', country: 'EG', lat: 30.0444, lng: 31.2357, aliases: ['Al-Qahirah', 'القاهرة', 'Giza', 'Greater Cairo'] }, // Tahrir Square
  { id: 'calgary', name: 'Calgary', context: 'Alberta, Canada', country: 'CA', lat: 51.0455, lng: -114.0640, aliases: ['YYC', 'Cowtown'] }, // Stephen Avenue, Downtown
  { id: 'cape-town', name: 'Cape Town', context: 'South Africa', country: 'ZA', lat: -33.9253, lng: 18.4239, aliases: ['Kaapstad', 'iKapa', 'Mother City'] }, // City Hall / Grand Parade
  { id: 'casablanca', name: 'Casablanca', context: 'Morocco', country: 'MA', lat: 33.5951, lng: -7.6185, aliases: ['Casa', 'Dar el-Beida', 'الدار البيضاء'] }, // Place des Nations Unies
  { id: 'charlotte', name: 'Charlotte', context: 'North Carolina, USA', country: 'US', lat: 35.2271, lng: -80.8431, aliases: ['CLT', 'Uptown Charlotte'] }, // Trade & Tryon (Independence Square)
  { id: 'chengdu', name: 'Chengdu', context: 'Sichuan, China', country: 'CN', lat: 30.6598, lng: 104.0633, aliases: ['Chengtu', '成都'] }, // Tianfu Square
  { id: 'chennai', name: 'Chennai', context: 'Tamil Nadu, India', country: 'IN', lat: 13.0825, lng: 80.2755, aliases: ['Madras', 'சென்னை'] }, // Chennai Central
  { id: 'chicago', name: 'Chicago', context: 'Illinois, USA', country: 'US', lat: 41.8820, lng: -87.6278, aliases: ['Chicagoland', 'The Loop', 'Windy City', 'CHI'] }, // State & Madison, the Loop
  { id: 'cincinnati', name: 'Cincinnati', context: 'Ohio, USA', country: 'US', lat: 39.1016, lng: -84.5125, aliases: ['Cincy'] }, // Fountain Square
  { id: 'cleveland', name: 'Cleveland', context: 'Ohio, USA', country: 'US', lat: 41.4995, lng: -81.6937, aliases: ['CLE'] }, // Public Square
  { id: 'cologne', name: 'Cologne', context: 'Germany', country: 'DE', lat: 50.9413, lng: 6.9583, aliases: ['Köln', 'Koeln', 'Koln', 'Rhineland', 'Rhine-Ruhr', 'Bonn', 'Leverkusen'] }, // Cologne Cathedral
  { id: 'columbus', name: 'Columbus', context: 'Ohio, USA', country: 'US', lat: 39.9612, lng: -82.9988, aliases: ['Cbus'] }, // Ohio Statehouse
  { id: 'copenhagen', name: 'Copenhagen', context: 'Denmark', country: 'DK', lat: 55.6759, lng: 12.5690, aliases: ['København', 'Kobenhavn', 'Kopenhagen', 'Øresund'] }, // Rådhuspladsen (City Hall Square)
  { id: 'dallas', name: 'Dallas', context: 'Texas, USA', country: 'US', lat: 32.7805, lng: -96.7995, aliases: ['DFW', 'Dallas–Fort Worth', 'Dallas-Fort Worth', 'Fort Worth', 'Metroplex', 'Plano'] }, // Main & Akard, Downtown
  { id: 'dar-es-salaam', name: 'Dar es Salaam', context: 'Tanzania', country: 'TZ', lat: -6.8166, lng: 39.2895, aliases: ['Dar'] }, // Askari Monument
  { id: 'delhi', name: 'Delhi', context: 'India', country: 'IN', lat: 28.6328, lng: 77.2197, aliases: ['New Delhi', 'Delhi NCR', 'NCR', 'Dilli', 'दिल्ली', 'Gurgaon', 'Gurugram', 'Noida'] }, // Connaught Place (Rajiv Chowk)
  { id: 'denver', name: 'Denver', context: 'Colorado, USA', country: 'US', lat: 39.7453, lng: -104.9925, aliases: ['Mile High City', 'Front Range', 'Aurora'] }, // 16th St Mall at California St
  { id: 'detroit', name: 'Detroit', context: 'Michigan, USA', country: 'US', lat: 42.3317, lng: -83.0465, aliases: ['Motor City', 'Metro Detroit', 'Motown'] }, // Campus Martius
  { id: 'dhaka', name: 'Dhaka', context: 'Bangladesh', country: 'BD', lat: 23.7278, lng: 90.4108, aliases: ['Dacca', 'ঢাকা'] }, // Zero Point (GPO), Gulistan
  { id: 'doha', name: 'Doha', context: 'Qatar', country: 'QA', lat: 25.2875, lng: 51.5330, aliases: ['Ad-Dawhah', 'الدوحة'] }, // Souq Waqif
  { id: 'dubai', name: 'Dubai', context: 'United Arab Emirates', country: 'AE', lat: 25.1972, lng: 55.2744, aliases: ['Dubayy', 'دبي', 'UAE', 'Deira', 'Sharjah'] }, // Downtown Dubai (Burj Khalifa)
  { id: 'dublin', name: 'Dublin', context: 'Ireland', country: 'IE', lat: 53.3472, lng: -6.2592, aliases: ['Baile Átha Cliath'] }, // O'Connell Bridge
  { id: 'edinburgh', name: 'Edinburgh', context: 'Scotland, UK', country: 'GB', lat: 55.9531, lng: -3.1897, aliases: ['Lothian', 'Leith', 'Auld Reekie'] }, // East end of Princes Street (Waverley)
  { id: 'frankfurt', name: 'Frankfurt', context: 'Germany', country: 'DE', lat: 50.1136, lng: 8.6794, aliases: ['Frankfurt am Main', 'Rhein-Main', 'Rhine-Main', 'FFM', 'Mainhattan'] }, // Hauptwache
  { id: 'fresno', name: 'Fresno', context: 'California, USA', country: 'US', lat: 36.7350, lng: -119.7900, aliases: ['Central Valley', 'San Joaquin Valley', 'Clovis'] }, // Downtown, Fulton St / Courthouse Park
  { id: 'glasgow', name: 'Glasgow', context: 'Scotland, UK', country: 'GB', lat: 55.8611, lng: -4.2502, aliases: ['Greater Glasgow', 'Clydeside'] }, // George Square
  { id: 'grand-rapids', name: 'Grand Rapids', context: 'Michigan, USA', country: 'US', lat: 42.9653, lng: -85.6717, aliases: ['West Michigan', 'GR'] }, // Rosa Parks Circle
  { id: 'guadalajara', name: 'Guadalajara', context: 'Jalisco, Mexico', country: 'MX', lat: 20.6770, lng: -103.3470, aliases: ['GDL', 'Zapopan'] }, // Guadalajara Cathedral
  { id: 'guangzhou', name: 'Guangzhou', context: 'Guangdong, China', country: 'CN', lat: 23.1302, lng: 113.2591, aliases: ['Canton', '广州', 'Pearl River Delta', 'Foshan'] }, // People's Park / Gongyuanqian
  { id: 'hamburg', name: 'Hamburg', context: 'Germany', country: 'DE', lat: 53.5503, lng: 9.9920, aliases: ['HH'] }, // Rathaus / Rathausmarkt
  { id: 'hanoi', name: 'Hanoi', context: 'Vietnam', country: 'VN', lat: 21.0287, lng: 105.8523, aliases: ['Hà Nội', 'Ha Noi'] }, // Hoàn Kiếm Lake
  { id: 'hartford', name: 'Hartford', context: 'Connecticut, USA', country: 'US', lat: 41.7661, lng: -72.6728 }, // Old State House
  { id: 'havana', name: 'Havana', context: 'Cuba', country: 'CU', lat: 23.1375, lng: -82.3588, aliases: ['La Habana', 'Habana'] }, // Parque Central
  { id: 'helsinki', name: 'Helsinki', context: 'Finland', country: 'FI', lat: 60.1708, lng: 24.9410, aliases: ['Helsingfors', 'Espoo', 'Vantaa'] }, // Central railway station
  { id: 'ho-chi-minh-city', name: 'Ho Chi Minh City', context: 'Vietnam', country: 'VN', lat: 10.7765, lng: 106.7009, aliases: ['Saigon', 'Sài Gòn', 'HCMC', 'Thành phố Hồ Chí Minh', 'TP.HCM'] }, // City Hall, Nguyễn Huệ, District 1
  { id: 'hong-kong', name: 'Hong Kong', context: 'China', country: 'HK', lat: 22.2818, lng: 114.1601, aliases: ['HK', '香港', 'Kowloon', 'HKSAR'] }, // Statue Square, Central
  { id: 'honolulu', name: 'Honolulu', context: 'Hawaii, USA', country: 'US', lat: 21.3080, lng: -157.8610, aliases: ['Oahu', 'Oʻahu', 'Waikiki', 'Hawaii', 'HNL'] }, // Downtown, Bishop & King St
  { id: 'houston', name: 'Houston', context: 'Texas, USA', country: 'US', lat: 29.7576, lng: -95.3644, aliases: ['H-Town', 'HTX', 'Space City', 'The Woodlands', 'Sugar Land'] }, // Main Street Square, Downtown
  { id: 'hyderabad', name: 'Hyderabad', context: 'Telangana, India', country: 'IN', lat: 17.3616, lng: 78.4747, aliases: ['Secunderabad', 'Cyberabad', 'HITEC City', 'హైదరాబాద్'] }, // Charminar
  { id: 'indianapolis', name: 'Indianapolis', context: 'Indiana, USA', country: 'US', lat: 39.7684, lng: -86.1581, aliases: ['Indy', 'Circle City'] }, // Monument Circle
  { id: 'istanbul', name: 'Istanbul', context: 'Turkey', country: 'TR', lat: 41.0369, lng: 28.9850, aliases: ['İstanbul', 'Constantinople', 'Bosphorus'] }, // Taksim Square
  { id: 'jacksonville', name: 'Jacksonville', context: 'Florida, USA', country: 'US', lat: 30.3293, lng: -81.6595, aliases: ['Jax', 'First Coast'] }, // James Weldon Johnson Park, Downtown
  { id: 'jakarta', name: 'Jakarta', context: 'Indonesia', country: 'ID', lat: -6.1754, lng: 106.8272, aliases: ['Jabodetabek', 'Batavia', 'DKI Jakarta'] }, // Monas (National Monument)
  { id: 'johannesburg', name: 'Johannesburg', context: 'South Africa', country: 'ZA', lat: -26.2069, lng: 28.0434, aliases: ['Joburg', 'Jozi', 'Egoli', 'Gauteng', 'Sandton', 'Soweto'] }, // Gandhi Square, CBD
  { id: 'kansas-city', name: 'Kansas City', context: 'Missouri, USA', country: 'US', lat: 39.0998, lng: -94.5832, aliases: ['KC', 'KCMO', 'Overland Park'] }, // 12th & Main, Downtown
  { id: 'karachi', name: 'Karachi', context: 'Pakistan', country: 'PK', lat: 24.8625, lng: 67.0295, aliases: ['کراچی'] }, // Empress Market, Saddar
  { id: 'kinshasa', name: 'Kinshasa', context: 'DR Congo', country: 'CD', lat: -4.3047, lng: 15.3075, aliases: ['Kin', 'Léopoldville', 'Leopoldville', 'Gombe'] }, // Boulevard du 30 Juin at the Grande Poste, Gombe
  { id: 'kolkata', name: 'Kolkata', context: 'West Bengal, India', country: 'IN', lat: 22.5646, lng: 88.3517, aliases: ['Calcutta', 'কলকাতা', 'Howrah'] }, // Esplanade (Dharmatala)
  { id: 'krakow', name: 'Kraków', context: 'Poland', country: 'PL', lat: 50.0617, lng: 19.9373, aliases: ['Krakow', 'Cracow'] }, // Rynek Główny (Main Square)
  { id: 'kuala-lumpur', name: 'Kuala Lumpur', context: 'Malaysia', country: 'MY', lat: 3.1488, lng: 101.6936, aliases: ['KL', 'Klang Valley', 'Petaling Jaya'] }, // Dataran Merdeka
  { id: 'kyiv', name: 'Kyiv', context: 'Ukraine', country: 'UA', lat: 50.4501, lng: 30.5234, aliases: ['Kiev', 'Київ'] }, // Maidan Nezalezhnosti
  { id: 'kyoto', name: 'Kyoto', context: 'Japan', country: 'JP', lat: 35.0036, lng: 135.7692, aliases: ['京都', 'Kyōto'] }, // Shijō-Kawaramachi
  { id: 'lagos', name: 'Lagos', context: 'Nigeria', country: 'NG', lat: 6.4538, lng: 3.3894, aliases: ['Eko', 'Lagos Island', 'Ikeja'] }, // Tinubu Square, Lagos Island
  { id: 'lahore', name: 'Lahore', context: 'Pakistan', country: 'PK', lat: 31.5596, lng: 74.3245, aliases: ['لاہور'] }, // Charing Cross, The Mall
  { id: 'las-vegas', name: 'Las Vegas', context: 'Nevada, USA', country: 'US', lat: 36.1707, lng: -115.1440, aliases: ['Vegas', 'The Strip', 'Paradise', 'Henderson', 'Sin City'] }, // Fremont Street, Downtown
  { id: 'lima', name: 'Lima', context: 'Peru', country: 'PE', lat: -12.0460, lng: -77.0305, aliases: ['Callao', 'Miraflores'] }, // Plaza Mayor (Plaza de Armas)
  { id: 'lisbon', name: 'Lisbon', context: 'Portugal', country: 'PT', lat: 38.7138, lng: -9.1393, aliases: ['Lisboa'] }, // Rossio (Praça Dom Pedro IV)
  { id: 'liverpool', name: 'Liverpool', context: 'England, UK', country: 'GB', lat: 53.4052, lng: -2.9835, aliases: ['Merseyside', 'Birkenhead', 'Wirral'] }, // Church Street, city centre
  { id: 'london', name: 'London', context: 'England, UK', country: 'GB', lat: 51.5073, lng: -0.1276, aliases: ['Greater London', 'City of London', 'Westminster', 'LDN'] }, // Charing Cross
  { id: 'los-angeles', name: 'Los Angeles', context: 'California, USA', country: 'US', lat: 34.0537, lng: -118.2428, aliases: ['LA', 'L.A.', 'DTLA', 'SoCal', 'Southern California', 'Hollywood', 'Santa Monica', 'Long Beach', 'Torrance', 'Orange County', 'Anaheim'] }, // City Hall, Downtown LA
  { id: 'louisville', name: 'Louisville', context: 'Kentucky, USA', country: 'US', lat: 38.2523, lng: -85.7573, aliases: ['Kentuckiana', 'Derby City'] }, // Fourth Street Live, Downtown
  { id: 'lyon', name: 'Lyon', context: 'France', country: 'FR', lat: 45.7578, lng: 4.8320, aliases: ['Lyons', 'Villeurbanne'] }, // Place Bellecour
  { id: 'madrid', name: 'Madrid', context: 'Spain', country: 'ES', lat: 40.4168, lng: -3.7038 }, // Puerta del Sol
  { id: 'manchester', name: 'Manchester', context: 'England, UK', country: 'GB', lat: 53.4794, lng: -2.2451, aliases: ['Greater Manchester', 'Salford', 'MCR'] }, // Albert Square (Town Hall)
  { id: 'manila', name: 'Manila', context: 'Philippines', country: 'PH', lat: 14.5818, lng: 120.9770, aliases: ['Metro Manila', 'Maynila', 'Makati', 'Quezon City'] }, // Rizal Park (Kilometre Zero)
  { id: 'marseille', name: 'Marseille', context: 'France', country: 'FR', lat: 43.2951, lng: 5.3744, aliases: ['Marseilles', 'Aix-en-Provence', 'Provence'] }, // Vieux-Port
  { id: 'medellin', name: 'Medellín', context: 'Colombia', country: 'CO', lat: 6.2503, lng: -75.5682, aliases: ['Medellin', 'Valle de Aburrá', 'Aburrá Valley'] }, // Parque Berrío
  { id: 'melbourne', name: 'Melbourne', context: 'Victoria, Australia', country: 'AU', lat: -37.8136, lng: 144.9631, aliases: ['Naarm', 'Port Phillip'] }, // GPO, Bourke & Elizabeth St
  { id: 'memphis', name: 'Memphis', context: 'Tennessee, USA', country: 'US', lat: 35.1460, lng: -90.0518, aliases: ['Bluff City', 'Mid-South'] }, // Court Square, Downtown
  { id: 'mexico-city', name: 'Mexico City', context: 'Mexico', country: 'MX', lat: 19.4326, lng: -99.1332, aliases: ['Ciudad de México', 'Ciudad de Mexico', 'CDMX', 'México D.F.', 'DF', 'Valle de México'] }, // Zócalo
  { id: 'miami', name: 'Miami', context: 'Florida, USA', country: 'US', lat: 25.7743, lng: -80.1937, aliases: ['South Florida', 'Miami Beach', 'Fort Lauderdale', 'MIA'] }, // Flagler St & Miami Ave
  { id: 'milan', name: 'Milan', context: 'Italy', country: 'IT', lat: 45.4641, lng: 9.1900, aliases: ['Milano', 'Lombardy'] }, // Piazza del Duomo
  { id: 'milwaukee', name: 'Milwaukee', context: 'Wisconsin, USA', country: 'US', lat: 43.0388, lng: -87.9090, aliases: ['MKE', 'Brew City'] }, // Wisconsin Ave & Water St
  { id: 'minneapolis', name: 'Minneapolis', context: 'Minnesota, USA', country: 'US', lat: 44.9765, lng: -93.2720, aliases: ['Twin Cities', 'Minneapolis–Saint Paul', 'Minneapolis-St. Paul', 'St. Paul', 'Saint Paul', 'MSP'] }, // Nicollet Mall at 7th St
  { id: 'monterrey', name: 'Monterrey', context: 'Nuevo León, Mexico', country: 'MX', lat: 25.6708, lng: -100.3092, aliases: ['MTY', 'San Pedro Garza García'] }, // Macroplaza
  { id: 'montreal', name: 'Montréal', context: 'Quebec, Canada', country: 'CA', lat: 45.5017, lng: -73.5685, aliases: ['Montreal', 'MTL', 'Laval'] }, // Place Ville Marie, Centre-Ville
  { id: 'moscow', name: 'Moscow', context: 'Russia', country: 'RU', lat: 55.7539, lng: 37.6208, aliases: ['Moskva', 'Москва'] }, // Red Square
  { id: 'mumbai', name: 'Mumbai', context: 'Maharashtra, India', country: 'IN', lat: 18.9400, lng: 72.8353, aliases: ['Bombay', 'मुंबई', 'Navi Mumbai', 'Thane'] }, // Chhatrapati Shivaji Maharaj Terminus, Fort
  { id: 'munich', name: 'Munich', context: 'Germany', country: 'DE', lat: 48.1374, lng: 11.5755, aliases: ['München', 'Muenchen', 'Munchen', 'Bavaria'] }, // Marienplatz
  { id: 'nagoya', name: 'Nagoya', context: 'Japan', country: 'JP', lat: 35.1700, lng: 136.9087, aliases: ['名古屋', 'Chukyo', 'Chūkyō', 'Aichi'] }, // Sakae
  { id: 'nairobi', name: 'Nairobi', context: 'Kenya', country: 'KE', lat: -1.2886, lng: 36.8231 }, // KICC / City Square
  { id: 'naples', name: 'Naples', context: 'Italy', country: 'IT', lat: 40.8359, lng: 14.2488, aliases: ['Napoli', 'Campania'] }, // Piazza del Plebiscito
  { id: 'nashville', name: 'Nashville', context: 'Tennessee, USA', country: 'US', lat: 36.1606, lng: -86.7785, aliases: ['Music City', 'Middle Tennessee'] }, // Broadway at 5th Ave
  { id: 'new-orleans', name: 'New Orleans', context: 'Louisiana, USA', country: 'US', lat: 29.9535, lng: -90.0700, aliases: ['NOLA', 'Big Easy', 'Crescent City', 'French Quarter'] }, // Canal St at St. Charles Ave
  { id: 'new-york', name: 'New York', context: 'New York, USA', country: 'US', lat: 40.7580, lng: -73.9855, aliases: ['NYC', 'New York City', 'Manhattan', 'Big Apple', 'Tri-State', 'Brooklyn', 'Newark'] }, // Times Square, Midtown Manhattan
  { id: 'norfolk', name: 'Norfolk', context: 'Virginia, USA', country: 'US', lat: 36.8468, lng: -76.2900, aliases: ['Hampton Roads', 'Virginia Beach', 'Tidewater', 'Newport News', 'Chesapeake'] }, // Downtown Norfolk
  { id: 'oakland', name: 'Oakland', context: 'California, USA', country: 'US', lat: 37.8044, lng: -122.2712, aliases: ['East Bay', 'Berkeley', 'Oaktown', 'Bay Area'] }, // 14th & Broadway / Frank Ogawa Plaza
  { id: 'oklahoma-city', name: 'Oklahoma City', context: 'Oklahoma, USA', country: 'US', lat: 35.4670, lng: -97.5165, aliases: ['OKC'] }, // Sheridan & Robinson, Downtown
  { id: 'omaha', name: 'Omaha', context: 'Nebraska, USA', country: 'US', lat: 41.2578, lng: -95.9372, aliases: ['Council Bluffs'] }, // 16th & Farnam, Downtown
  { id: 'orlando', name: 'Orlando', context: 'Florida, USA', country: 'US', lat: 28.5421, lng: -81.3790, aliases: ['Central Florida', 'Kissimmee', 'Disney World'] }, // Orange Ave & Central Blvd
  { id: 'osaka', name: 'Osaka', context: 'Japan', country: 'JP', lat: 34.7025, lng: 135.4960, aliases: ['大阪', 'Ōsaka', 'Kansai', 'Keihanshin', 'Kobe', 'Umeda'] }, // Ōsaka Station, Umeda
  { id: 'oslo', name: 'Oslo', context: 'Norway', country: 'NO', lat: 59.9127, lng: 10.7417 }, // Karl Johans gate at Stortinget
  { id: 'ottawa', name: 'Ottawa', context: 'Ontario, Canada', country: 'CA', lat: 45.4241, lng: -75.6990, aliases: ['Gatineau', 'Ottawa–Gatineau', 'National Capital Region'] }, // Parliament Hill
  { id: 'paris', name: 'Paris', context: 'France', country: 'FR', lat: 48.8534, lng: 2.3488, aliases: ['Île-de-France', 'Ile-de-France', 'Grand Paris', 'La Défense'] }, // Notre-Dame (point zéro), Île de la Cité
  { id: 'perth', name: 'Perth', context: 'Western Australia', country: 'AU', lat: -31.9524, lng: 115.8593, aliases: ['Boorloo', 'Fremantle'] }, // Forrest Place
  { id: 'philadelphia', name: 'Philadelphia', context: 'Pennsylvania, USA', country: 'US', lat: 39.9526, lng: -75.1635, aliases: ['Philly', 'Delaware Valley', 'Center City'] }, // City Hall
  { id: 'phoenix', name: 'Phoenix', context: 'Arizona, USA', country: 'US', lat: 33.4484, lng: -112.0740, aliases: ['Valley of the Sun', 'The Valley', 'Scottsdale', 'Tempe', 'Mesa', 'PHX'] }, // Central Ave & Washington St
  { id: 'pittsburgh', name: 'Pittsburgh', context: 'Pennsylvania, USA', country: 'US', lat: 40.4406, lng: -80.0020, aliases: ['Steel City', 'PGH'] }, // Market Square
  { id: 'portland', name: 'Portland', context: 'Oregon, USA', country: 'US', lat: 45.5190, lng: -122.6793, aliases: ['PDX', 'Rose City', 'Beaverton'] }, // Pioneer Courthouse Square
  { id: 'porto', name: 'Porto', context: 'Portugal', country: 'PT', lat: 41.1466, lng: -8.6110, aliases: ['Oporto', 'Vila Nova de Gaia'] }, // Praça da Liberdade / Aliados
  { id: 'prague', name: 'Prague', context: 'Czechia', country: 'CZ', lat: 50.0875, lng: 14.4213, aliases: ['Praha', 'Prag'] }, // Old Town Square
  { id: 'providence', name: 'Providence', context: 'Rhode Island, USA', country: 'US', lat: 41.8251, lng: -71.4113, aliases: ['Rhode Island', 'PVD'] }, // Kennedy Plaza
  { id: 'raleigh', name: 'Raleigh', context: 'North Carolina, USA', country: 'US', lat: 35.7804, lng: -78.6391, aliases: ['Research Triangle', 'The Triangle', 'Durham', 'Chapel Hill', 'RDU'] }, // North Carolina State Capitol
  { id: 'richmond', name: 'Richmond', context: 'Virginia, USA', country: 'US', lat: 37.5388, lng: -77.4336, aliases: ['RVA'] }, // Virginia State Capitol
  { id: 'rio-de-janeiro', name: 'Rio de Janeiro', context: 'Brazil', country: 'BR', lat: -22.9074, lng: -43.1783, aliases: ['Rio', 'Copacabana', 'Niterói'] }, // Largo da Carioca, Centro
  { id: 'riverside', name: 'Riverside', context: 'California, USA', country: 'US', lat: 33.9820, lng: -117.3745, aliases: ['Inland Empire', 'San Bernardino', 'IE', 'Rancho Cucamonga'] }, // Downtown Riverside (Main St / Mission Inn)
  { id: 'riyadh', name: 'Riyadh', context: 'Saudi Arabia', country: 'SA', lat: 24.6311, lng: 46.7134, aliases: ['Ar-Riyad', 'الرياض'] }, // Deera Square / Al Masmak
  { id: 'rochester', name: 'Rochester', context: 'New York, USA', country: 'US', lat: 43.1576, lng: -77.6048, aliases: ['ROC', 'Flower City'] }, // Liberty Pole, Main St
  { id: 'rome', name: 'Rome', context: 'Italy', country: 'IT', lat: 41.8959, lng: 12.4825, aliases: ['Roma', 'Lazio', 'Vatican'] }, // Piazza Venezia
  { id: 'sacramento', name: 'Sacramento', context: 'California, USA', country: 'US', lat: 38.5767, lng: -121.4934, aliases: ['Sac', 'Sactown', 'Roseville'] }, // California State Capitol
  { id: 'saint-petersburg', name: 'Saint Petersburg', context: 'Russia', country: 'RU', lat: 59.9390, lng: 30.3157, aliases: ['St. Petersburg', 'St Petersburg', 'Sankt-Peterburg', 'Санкт-Петербург', 'Leningrad', 'Piter'] }, // Palace Square
  { id: 'salt-lake-city', name: 'Salt Lake City', context: 'Utah, USA', country: 'US', lat: 40.7694, lng: -111.8910, aliases: ['SLC', 'Salt Lake', 'Wasatch Front'] }, // Main St & South Temple (Temple Square)
  { id: 'san-antonio', name: 'San Antonio', context: 'Texas, USA', country: 'US', lat: 29.4257, lng: -98.4863, aliases: ['Alamo City', 'SATX'] }, // Alamo Plaza
  { id: 'san-diego', name: 'San Diego', context: 'California, USA', country: 'US', lat: 32.7157, lng: -117.1611, aliases: ['SD', 'Chula Vista', 'La Jolla'] }, // Broadway & 4th Ave (Horton Plaza)
  { id: 'san-francisco', name: 'San Francisco', context: 'California, USA', country: 'US', lat: 37.7879, lng: -122.4075, aliases: ['SF', 'San Fran', 'Frisco', 'The City', 'Bay Area'] }, // Union Square
  { id: 'san-jose', name: 'San Jose', context: 'California, USA', country: 'US', lat: 37.3322, lng: -121.8896, aliases: ['South Bay', 'Silicon Valley', 'Santa Clara Valley', 'San José', 'SJ', 'Santa Clara', 'Sunnyvale', 'Mountain View', 'Palo Alto', 'Cupertino', 'Bay Area'] }, // Plaza de César Chávez, Downtown
  { id: 'san-juan', name: 'San Juan', context: 'Puerto Rico', country: 'PR', lat: 18.4658, lng: -66.1166, aliases: ['Old San Juan', 'Viejo San Juan', 'Bayamón'] }, // Plaza de Armas, Old San Juan
  { id: 'santa-barbara', name: 'Santa Barbara', context: 'California, USA', country: 'US', lat: 34.4200, lng: -119.6990, aliases: ['SB', 'American Riviera', 'Goleta', 'Montecito'] }, // State St at De la Guerra Plaza
  { id: 'santiago', name: 'Santiago', context: 'Chile', country: 'CL', lat: -33.4378, lng: -70.6505, aliases: ['Santiago de Chile'] }, // Plaza de Armas
  { id: 'sao-paulo', name: 'São Paulo', context: 'Brazil', country: 'BR', lat: -23.5505, lng: -46.6333, aliases: ['Sao Paulo', 'Sampa', 'SP', 'Grande São Paulo'] }, // Praça da Sé (marco zero)
  { id: 'seattle', name: 'Seattle', context: 'Washington, USA', country: 'US', lat: 47.6110, lng: -122.3370, aliases: ['Puget Sound', 'Emerald City', 'Tacoma', 'Bellevue', 'SEA'] }, // Westlake Park, Downtown
  { id: 'seoul', name: 'Seoul', context: 'South Korea', country: 'KR', lat: 37.5657, lng: 126.9780, aliases: ['서울', 'Incheon', 'Gyeonggi', 'Sudogwon'] }, // Seoul Plaza (City Hall)
  { id: 'shanghai', name: 'Shanghai', context: 'China', country: 'CN', lat: 31.2315, lng: 121.4700, aliases: ['上海', 'Pudong'] }, // People's Square
  { id: 'shenzhen', name: 'Shenzhen', context: 'Guangdong, China', country: 'CN', lat: 22.5464, lng: 114.0545, aliases: ['深圳', 'Futian', 'Pearl River Delta'] }, // Civic Center, Futian
  { id: 'singapore', name: 'Singapore', context: 'Republic of Singapore', country: 'SG', lat: 1.2841, lng: 103.8515, aliases: ['SG', 'Singapura', '新加坡', 'Lion City'] }, // Raffles Place
  { id: 'st-louis', name: 'St. Louis', context: 'Missouri, USA', country: 'US', lat: 38.6261, lng: -90.1910, aliases: ['Saint Louis', 'STL', 'Gateway City'] }, // Kiener Plaza, Downtown
  { id: 'stockholm', name: 'Stockholm', context: 'Sweden', country: 'SE', lat: 59.3326, lng: 18.0649 }, // Sergels torg
  { id: 'sydney', name: 'Sydney', context: 'New South Wales, Australia', country: 'AU', lat: -33.8678, lng: 151.2073, aliases: ['Parramatta', 'NSW'] }, // GPO, Martin Place
  { id: 'taipei', name: 'Taipei', context: 'Taiwan', country: 'TW', lat: 25.0478, lng: 121.5170, aliases: ['台北', '臺北', 'Taibei', 'New Taipei'] }, // Taipei Main Station
  { id: 'tampa', name: 'Tampa', context: 'Florida, USA', country: 'US', lat: 27.9477, lng: -82.4584, aliases: ['Tampa Bay', 'St. Pete', 'Clearwater'] }, // Kennedy Blvd & Franklin St
  { id: 'tehran', name: 'Tehran', context: 'Iran', country: 'IR', lat: 35.6858, lng: 51.4213, aliases: ['Teheran', 'تهران'] }, // Imam Khomeini (Toopkhaneh) Square
  { id: 'tel-aviv', name: 'Tel Aviv', context: 'Israel', country: 'IL', lat: 32.0809, lng: 34.7808, aliases: ['Tel Aviv-Yafo', 'Gush Dan', 'Jaffa', 'TLV', 'תל אביב'] }, // Rabin Square
  { id: 'tijuana', name: 'Tijuana', context: 'Baja California, Mexico', country: 'MX', lat: 32.5320, lng: -117.0367, aliases: ['TJ', 'Baja'] }, // Avenida Revolución, Zona Centro
  { id: 'tokyo', name: 'Tokyo', context: 'Japan', country: 'JP', lat: 35.6812, lng: 139.7671, aliases: ['東京', 'Tōkyō', 'Kanto', 'Kantō', 'Yokohama', 'Greater Tokyo'] }, // Tokyo Station
  { id: 'toronto', name: 'Toronto', context: 'Ontario, Canada', country: 'CA', lat: 43.6525, lng: -79.3835, aliases: ['GTA', 'Greater Toronto Area', 'The 6ix', 'Mississauga', 'Golden Horseshoe'] }, // Nathan Phillips Square (City Hall)
  { id: 'tucson', name: 'Tucson', context: 'Arizona, USA', country: 'US', lat: 32.2220, lng: -110.9713, aliases: ['Old Pueblo'] }, // Congress St & Stone Ave
  { id: 'tulsa', name: 'Tulsa', context: 'Oklahoma, USA', country: 'US', lat: 36.1515, lng: -95.9901, aliases: ['Green Country'] }, // 5th & Main (Bartlett Square), Downtown
  { id: 'valencia', name: 'Valencia', context: 'Spain', country: 'ES', lat: 39.4699, lng: -0.3763, aliases: ['València'] }, // Plaça de l'Ajuntament
  { id: 'vancouver', name: 'Vancouver', context: 'British Columbia, Canada', country: 'CA', lat: 49.2827, lng: -123.1187, aliases: ['Metro Vancouver', 'Lower Mainland', 'YVR', 'Burnaby', 'Surrey'] }, // Granville & Georgia
  { id: 'vienna', name: 'Vienna', context: 'Austria', country: 'AT', lat: 48.2085, lng: 16.3731, aliases: ['Wien'] }, // Stephansplatz
  { id: 'warsaw', name: 'Warsaw', context: 'Poland', country: 'PL', lat: 52.2299, lng: 21.0117, aliases: ['Warszawa'] }, // Rondo Dmowskiego (Centrum)
  { id: 'washington', name: 'Washington', context: 'D.C., USA', country: 'US', lat: 38.8977, lng: -77.0365, aliases: ['DC', 'D.C.', 'Washington DC', 'Washington, D.C.', 'DMV', 'The District', 'Northern Virginia', 'NoVA', 'Arlington'] }, // The White House
  { id: 'zurich', name: 'Zurich', context: 'Switzerland', country: 'CH', lat: 47.3698, lng: 8.5390, aliases: ['Zürich', 'Zuerich'] }, // Paradeplatz
];
