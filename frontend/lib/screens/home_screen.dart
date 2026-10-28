import 'package:flutter/material.dart';
import 'package:life_logger/models/entry.dart';
import 'package:life_logger/models/location_point.dart';
import 'package:life_logger/screens/create_entry_screen.dart';
import 'package:life_logger/services/api_service.dart';

class HomeScreen extends StatefulWidget {
  const HomeScreen({super.key});

  @override
  State<HomeScreen> createState() => _HomeScreenState();
}

class _HomeScreenState extends State<HomeScreen> {
  int _selectedIndex = 0;
  bool _isLoading = true;
  Map<String, dynamic> _dashboard = {};
  List<Entry> _entries = [];
  List<LocationPoint> _locations = [];

  @override
  void initState() {
    super.initState();
    _loadData();
  }

  Future<void> _loadData() async {
    try {
      final dashboard = await ApiService.fetchDashboard();
      final entries = await ApiService.fetchEntries();
      final locations = await ApiService.fetchLocations();

      if (!mounted) return;
      setState(() {
        _dashboard = dashboard;
        _entries = entries.map((e) => Entry.fromJson(e)).toList();
        _locations = locations.map((l) => LocationPoint.fromJson(l)).toList();
        _isLoading = false;
      });
    } catch (e) {
      if (!mounted) return;
      setState(() => _isLoading = false);
      debugPrint('Failed to load data: $e');
    }
  }

  Future<void> _openCreateEntry() async {
    final created = await Navigator.of(context).push<bool>(
      MaterialPageRoute(builder: (_) => const CreateEntryScreen()),
    );
    if (created == true) {
      await _loadData();
    }
  }

  @override
  Widget build(BuildContext context) {
    final tabs = [
      _buildHomeTab(),
      _buildJourneyTab(),
      _buildProfileTab(),
    ];

    return Scaffold(
      backgroundColor: const Color(0xFF071B2E),
      body: SafeArea(
        child: _isLoading
            ? const Center(
                child: CircularProgressIndicator(color: Color(0xFF7FC7FF)),
              )
            : tabs[_selectedIndex],
      ),
      bottomNavigationBar: Container(
        decoration: BoxDecoration(
          color: const Color(0xFF0C2340),
          border: Border(top: BorderSide(color: Colors.white.withOpacity(0.08))),
        ),
        child: BottomNavigationBar(
          currentIndex: _selectedIndex,
          onTap: (index) => setState(() => _selectedIndex = index),
          backgroundColor: Colors.transparent,
          type: BottomNavigationBarType.fixed,
          selectedItemColor: const Color(0xFF7FC7FF),
          unselectedItemColor: Colors.white70,
          items: const [
            BottomNavigationBarItem(icon: Icon(Icons.home_rounded), label: '日記'),
            BottomNavigationBarItem(icon: Icon(Icons.map_rounded), label: '足跡'),
            BottomNavigationBarItem(icon: Icon(Icons.person_rounded), label: '我的'),
          ],
        ),
      ),
    );
  }

  Widget _buildHomeTab() {
    final latestEntry = _dashboard['latest_entry'] != null ? Entry.fromJson(_dashboard['latest_entry']) : null;

    return SingleChildScrollView(
      padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: const [
                  Text(
                    'Life Logger',
                    style: TextStyle(fontSize: 28, fontWeight: FontWeight.w700, color: Colors.white),
                  ),
                  SizedBox(height: 4),
                  Text(
                    '每日心情與足跡整理簿',
                    style: TextStyle(fontSize: 13, color: Color(0xFF9AB6D1)),
                  ),
                ],
              ),
              Semantics(
                button: true,
                label: '新增日記',
                child: InkWell(
                  onTap: _openCreateEntry,
                  customBorder: const CircleBorder(),
                  child: Container(
                    width: 42,
                    height: 42,
                    decoration: BoxDecoration(
                      shape: BoxShape.circle,
                      gradient: const LinearGradient(
                        colors: [Color(0xFF7FC7FF), Color(0xFF4AA3FF)],
                      ),
                      boxShadow: [
                        BoxShadow(
                          color: const Color(0xFF4AA3FF).withOpacity(0.35),
                          blurRadius: 16,
                          offset: const Offset(0, 8),
                        )
                      ],
                    ),
                    child: const Icon(Icons.add, color: Colors.white),
                  ),
                ),
              )
            ],
          ),
          const SizedBox(height: 18),
          _buildHeroCard(latestEntry),
          const SizedBox(height: 20),
          const Text(
            '近期時間軸',
            style: TextStyle(fontSize: 22, fontWeight: FontWeight.w700, color: Colors.white),
          ),
          const SizedBox(height: 12),
          ..._entries.map(_buildEntryCard).toList(),
        ],
      ),
    );
  }

  Widget _buildHeroCard(Entry? latestEntry) {
    final date = DateTime.now();
    final formattedDate = '${date.year}/${date.month.toString().padLeft(2, '0')}/${date.day.toString().padLeft(2, '0')}';

    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(20),
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(28),
        gradient: const LinearGradient(
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
          colors: [Color(0xFF0F2A43), Color(0xFF113D5C), Color(0xFF1D5F8F)],
        ),
        boxShadow: [
          BoxShadow(
            color: const Color(0xFF4AA3FF).withOpacity(0.18),
            blurRadius: 22,
            offset: const Offset(0, 10),
          )
        ],
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
                decoration: BoxDecoration(
                  color: Colors.white.withOpacity(0.08),
                  borderRadius: BorderRadius.circular(999),
                ),
                child: const Text('天文照片', style: TextStyle(color: Colors.white70, fontSize: 12)),
              ),
              const Icon(Icons.nightlight_rounded, color: Color(0xFF9AD0FF)),
            ],
          ),
          const SizedBox(height: 18),
          Text(
            formattedDate,
            style: const TextStyle(fontSize: 36, fontWeight: FontWeight.w700, color: Colors.white),
          ),
          const SizedBox(height: 12),
          Text(
            latestEntry?.title ?? '朵久沒有出去玩了',
            style: const TextStyle(fontSize: 22, fontWeight: FontWeight.w600, color: Colors.white),
          ),
          const SizedBox(height: 8),
          Text(
            latestEntry?.content ??
                '這幾天看著時間飛逝，終於抽出空檔和朋友去走一段街道，心情很輕鬆。',
            maxLines: 3,
            overflow: TextOverflow.ellipsis,
            style: TextStyle(fontSize: 14, color: Colors.white.withOpacity(0.78), height: 1.6),
          ),
        ],
      ),
    );
  }

  Widget _buildEntryCard(Entry entry) {
    return Container(
      margin: const EdgeInsets.only(bottom: 14),
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: const Color(0xFF11263F),
        borderRadius: BorderRadius.circular(22),
        border: Border.all(color: Colors.white.withOpacity(0.06)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Text(
                entry.title,
                style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w700, color: Colors.white),
              ),
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 5),
                decoration: BoxDecoration(
                  color: const Color(0xFF7FC7FF).withOpacity(0.12),
                  borderRadius: BorderRadius.circular(999),
                ),
                child: Text(
                  entry.mood,
                  style: const TextStyle(fontSize: 11, color: Color(0xFF9AD0FF)),
                ),
              ),
            ],
          ),
          const SizedBox(height: 8),
          Text(
            entry.content,
            style: TextStyle(fontSize: 14, color: Colors.white.withOpacity(0.78), height: 1.6),
          ),
          const SizedBox(height: 12),
          Row(
            children: [
              const Icon(Icons.location_on_rounded, size: 15, color: Color(0xFF8FD9FF)),
              const SizedBox(width: 6),
              Text(
                entry.location ?? '未紀錄位置',
                style: const TextStyle(fontSize: 12, color: Color(0xFFB8D5F2)),
              ),
            ],
          ),
          const SizedBox(height: 12),
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Text(
                entry.createdAt.isNotEmpty ? entry.createdAt.substring(0, 16) : '今天',
                style: const TextStyle(fontSize: 12, color: Colors.white54),
              ),
              if (entry.tags != null && entry.tags!.isNotEmpty)
                Text(
                  '#${entry.tags!}',
                  style: const TextStyle(fontSize: 12, color: Color(0xFF9AD0FF)),
                ),
            ],
          ),
        ],
      ),
    );
  }

  Widget _buildJourneyTab() {
    return SingleChildScrollView(
      padding: const EdgeInsets.all(20),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Text(
            '足跡地圖',
            style: TextStyle(fontSize: 28, fontWeight: FontWeight.w700, color: Colors.white),
          ),
          const SizedBox(height: 16),
          Container(
            height: 240,
            width: double.infinity,
            decoration: BoxDecoration(
              borderRadius: BorderRadius.circular(28),
              gradient: const LinearGradient(
                begin: Alignment.topLeft,
                end: Alignment.bottomRight,
                colors: [Color(0xFF0B1A2B), Color(0xFF153A57), Color(0xFF0C2B4B)],
              ),
            ),
            child: Stack(
              children: [
                Positioned.fill(
                  child: CustomPaint(
                    painter: MapGridPainter(),
                  ),
                ),
                ..._locations.map((point) {
                  final dx = 70.0 + ((_locations.indexOf(point) + 1) * 70.0) % 220;
                  final dy = 90.0 + ((_locations.indexOf(point) + 2) * 60.0) % 110;
                  return Positioned(
                    left: dx,
                    top: dy,
                    child: Container(
                      width: 12,
                      height: 12,
                      decoration: const BoxDecoration(
                        color: Color(0xFF7FC7FF),
                        shape: BoxShape.circle,
                        boxShadow: [
                          BoxShadow(color: Color(0xFF7FC7FF), blurRadius: 12),
                        ],
                      ),
                    ),
                  );
                }).toList(),
              ],
            ),
          ),
          const SizedBox(height: 16),
          const Text(
            '最近足跡',
            style: TextStyle(fontSize: 20, fontWeight: FontWeight.w700, color: Colors.white),
          ),
          const SizedBox(height: 12),
          ..._locations.map((point) => Container(
                margin: const EdgeInsets.only(bottom: 12),
                padding: const EdgeInsets.all(16),
                decoration: BoxDecoration(
                  color: const Color(0xFF11263F),
                  borderRadius: BorderRadius.circular(18),
                ),
                child: Row(
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  children: [
                    Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          point.name,
                          style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w600, color: Colors.white),
                        ),
                        const SizedBox(height: 6),
                        Text(
                          point.note ?? '安心半日走走',
                          style: TextStyle(fontSize: 12, color: Colors.white.withOpacity(0.7)),
                        ),
                      ],
                    ),
                    const Icon(Icons.arrow_forward_ios_rounded, color: Colors.white54, size: 16),
                  ],
                ),
              )),
        ],
      ),
    );
  }

  Widget _buildProfileTab() {
    return Padding(
      padding: const EdgeInsets.all(20),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Text(
            '我的',
            style: TextStyle(fontSize: 28, fontWeight: FontWeight.w700, color: Colors.white),
          ),
          const SizedBox(height: 20),
          Container(
            padding: const EdgeInsets.all(20),
            decoration: BoxDecoration(
              borderRadius: BorderRadius.circular(24),
              color: const Color(0xFF11263F),
            ),
            child: Row(
              children: [
                Container(
                  width: 58,
                  height: 58,
                  decoration: const BoxDecoration(
                    shape: BoxShape.circle,
                    gradient: LinearGradient(
                      colors: [Color(0xFF7FC7FF), Color(0xFF5E9CF6)],
                    ),
                  ),
                  child: const Icon(Icons.person, color: Colors.white),
                ),
                const SizedBox(width: 16),
                Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: const [
                    Text('小雨', style: TextStyle(fontSize: 20, fontWeight: FontWeight.w700, color: Colors.white)),
                    SizedBox(height: 4),
                    Text('在路上記錄溫柔生活', style: TextStyle(fontSize: 13, color: Colors.white60)),
                  ],
                )
              ],
            ),
          ),
          const SizedBox(height: 18),
          _buildMetricCard('總日記', '${_dashboard['entry_count'] ?? _entries.length}', '篇'),
          const SizedBox(height: 14),
          _buildMetricCard('最近足跡', '${_locations.length}', '次'),
          const SizedBox(height: 14),
          _buildMetricCard('隱私設定', '開啟', '保護'),
        ],
      ),
    );
  }

  Widget _buildMetricCard(String title, String value, String suffix) {
    return Container(
      padding: const EdgeInsets.all(18),
      decoration: BoxDecoration(
        color: const Color(0xFF11263F),
        borderRadius: BorderRadius.circular(20),
      ),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.spaceBetween,
        children: [
          Text(title, style: const TextStyle(fontSize: 16, color: Colors.white70)),
          RichText(
            text: TextSpan(
              children: [
                TextSpan(
                  text: value,
                  style: const TextStyle(fontSize: 28, fontWeight: FontWeight.w700, color: Colors.white),
                ),
                TextSpan(
                  text: ' $suffix',
                  style: const TextStyle(fontSize: 14, color: Color(0xFF9AD0FF)),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class MapGridPainter extends CustomPainter {
  @override
  void paint(Canvas canvas, Size size) {
    final paint = Paint()
      ..color = Colors.white.withOpacity(0.08)
      ..strokeWidth = 1;

    for (double x = 0; x <= size.width; x += 28) {
      canvas.drawLine(Offset(x, 0), Offset(x, size.height), paint);
    }
    for (double y = 0; y <= size.height; y += 28) {
      canvas.drawLine(Offset(0, y), Offset(size.width, y), paint);
    }
  }

  @override
  bool shouldRepaint(covariant CustomPainter oldDelegate) => false;
}
