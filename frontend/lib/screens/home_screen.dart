import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:life_logger/models/entry.dart';
import 'package:life_logger/models/location_point.dart';
import 'package:life_logger/models/user_profile.dart';
import 'package:life_logger/screens/create_entry_screen.dart';
import 'package:life_logger/screens/create_footprint_screen.dart';
import 'package:life_logger/screens/footprint_map_screen.dart';
import 'package:life_logger/services/api_service.dart';
import 'package:life_logger/theme/app_theme.dart';
import 'package:life_logger/utils/formatters.dart';
import 'package:url_launcher/url_launcher.dart';

class HomeScreen extends StatefulWidget {
  const HomeScreen({super.key});

  @override
  State<HomeScreen> createState() => _HomeScreenState();
}

class _HomeScreenState extends State<HomeScreen> {
  int _selectedIndex = 0;
  bool _isLoading = true;
  String? _error;
  Map<String, dynamic> _dashboard = {};
  List<Entry> _entries = [];
  List<LocationPoint> _locations = [];
  UserProfile? _profile;

  @override
  void initState() {
    super.initState();
    _loadData();
  }

  Future<void> _loadData() async {
    try {
      final results = await Future.wait<Object>([
        ApiService.fetchDashboard(),
        ApiService.fetchEntries(),
        ApiService.fetchLocations(),
        ApiService.fetchProfile(),
      ]);

      if (!mounted) return;
      setState(() {
        _dashboard = results[0] as Map<String, dynamic>;
        _entries = (results[1] as List<dynamic>)
            .map((e) => Entry.fromJson(e))
            .toList();
        _locations = (results[2] as List<dynamic>)
            .map((l) => LocationPoint.fromJson(l))
            .toList();
        _profile = results[3] as UserProfile;
        _error = null;
        _isLoading = false;
      });
    } catch (error) {
      debugPrint('Failed to load data: $error');
      if (!mounted) return;
      setState(() {
        _error = error is ApiException ? error.message : '伺服器回傳的資料無法讀取';
        _isLoading = false;
      });
    }
  }

  Future<void> _retry() async {
    setState(() {
      _isLoading = true;
      _error = null;
    });
    await _loadData();
  }

  Future<void> _openCreateScreen(Widget screen) async {
    final created = await Navigator.of(context).push<bool>(
      MaterialPageRoute(builder: (_) => screen),
    );
    if (created == true) {
      await _loadData();
    }
  }

  Widget _buildAddButton(String label, Widget screen) {
    return Semantics(
      container: true,
      button: true,
      label: label,
      child: InkWell(
        onTap: () => _openCreateScreen(screen),
        customBorder: const CircleBorder(),
        child: Container(
          width: 48,
          height: 48,
          decoration: BoxDecoration(
            shape: BoxShape.circle,
            gradient: AppColors.actionGradient,
            boxShadow: [
              BoxShadow(
                color: AppColors.accentStrong.withValues(alpha: 0.35),
                blurRadius: 16,
                offset: const Offset(0, 8),
              )
            ],
          ),
          child: const Icon(Icons.add, color: Colors.white),
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: SafeArea(
        child: Center(
          child: ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: 640),
            child: _buildBody(),
          ),
        ),
      ),
      bottomNavigationBar: Container(
        decoration: const BoxDecoration(
          color: AppColors.card,
          border: Border(top: BorderSide(color: AppColors.outline)),
        ),
        child: BottomNavigationBar(
          currentIndex: _selectedIndex,
          onTap: (index) => setState(() => _selectedIndex = index),
          items: const [
            BottomNavigationBarItem(icon: Icon(Icons.home_rounded), label: '日記'),
            BottomNavigationBarItem(icon: Icon(Icons.map_rounded), label: '足跡'),
            BottomNavigationBarItem(icon: Icon(Icons.person_rounded), label: '我的'),
          ],
        ),
      ),
    );
  }

  Widget _buildBody() {
    if (_isLoading) {
      return const Center(child: CircularProgressIndicator());
    }
    // Keep already loaded data on screen when only a later refresh failed.
    if (_error != null && _profile == null) {
      return _LoadErrorView(message: _error!, onRetry: _retry);
    }
    return switch (_selectedIndex) {
      0 => _buildHomeTab(),
      1 => _buildJourneyTab(),
      _ => _buildProfileTab(),
    };
  }

  Widget _buildTabList({required List<Widget> children}) {
    return RefreshIndicator(
      onRefresh: _loadData,
      child: ListView(
        physics: const AlwaysScrollableScrollPhysics(),
        padding: const EdgeInsets.all(20),
        children: [
          if (_error != null) ...[
            Text(
              '資料更新失敗：$_error',
              style: const TextStyle(color: AppColors.error, fontSize: 13),
            ),
            const SizedBox(height: 12),
          ],
          ...children,
        ],
      ),
    );
  }

  Widget _buildHomeTab() {
    final latestEntry = _dashboard['latest_entry'] != null ? Entry.fromJson(_dashboard['latest_entry']) : null;

    return _buildTabList(
      children: [
        Row(
          children: [
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    'Life Logger',
                    style: Theme.of(context).textTheme.headlineMedium,
                  ),
                  const SizedBox(height: 4),
                  const Text(
                    '每日心情與足跡整理簿',
                    style: TextStyle(fontSize: 13, color: AppColors.textMuted),
                  ),
                ],
              ),
            ),
            _buildAddButton('新增日記', const CreateEntryScreen()),
          ],
        ),
        const SizedBox(height: 18),
        _buildHeroCard(latestEntry),
        const SizedBox(height: 20),
        Text('近期時間軸', style: Theme.of(context).textTheme.titleLarge),
        const SizedBox(height: 12),
        if (_entries.isEmpty)
          const _EmptyMessage('還沒有日記，按右上角的 + 寫下第一篇吧')
        else
          ..._entries.map(_buildEntryCard),
      ],
    );
  }

  Widget _buildHeroCard(Entry? latestEntry) {
    final date = latestEntry == null ? null : parseServerTime(latestEntry.createdAt);

    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(20),
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(28),
        gradient: AppColors.heroGradient,
        boxShadow: [
          BoxShadow(
            color: AppColors.accentStrong.withValues(alpha: 0.18),
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
                  color: AppColors.outline,
                  borderRadius: BorderRadius.circular(999),
                ),
                child: const Text('最新日記', style: TextStyle(color: AppColors.textSecondary, fontSize: 12)),
              ),
              const Icon(Icons.nightlight_rounded, color: AppColors.accentSoft),
            ],
          ),
          const SizedBox(height: 18),
          Text(
            formatDate(date ?? DateTime.now()),
            style: const TextStyle(fontSize: 36, fontWeight: FontWeight.w700, color: Colors.white),
          ),
          const SizedBox(height: 12),
          Text(
            latestEntry?.title ?? '今天過得如何？',
            maxLines: 2,
            overflow: TextOverflow.ellipsis,
            style: const TextStyle(fontSize: 22, fontWeight: FontWeight.w600, color: Colors.white),
          ),
          const SizedBox(height: 8),
          Text(
            latestEntry?.content ?? '寫下第一篇日記後，最新的內容會顯示在這裡。',
            maxLines: 3,
            overflow: TextOverflow.ellipsis,
            style: const TextStyle(fontSize: 14, color: AppColors.textBody, height: 1.6),
          ),
        ],
      ),
    );
  }

  Widget _buildEntryCard(Entry entry) {
    final createdAt = parseServerTime(entry.createdAt);
    final tags = entry.tagList;

    return Container(
      margin: const EdgeInsets.only(bottom: 14),
      padding: const EdgeInsets.all(16),
      decoration: AppTheme.cardDecoration,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Expanded(
                child: Text(
                  entry.title,
                  style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w700, color: Colors.white),
                ),
              ),
              const SizedBox(width: 12),
              ConstrainedBox(
                constraints: const BoxConstraints(maxWidth: 120),
                child: Container(
                  padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 5),
                  decoration: BoxDecoration(
                    color: AppColors.accent.withValues(alpha: 0.12),
                    borderRadius: BorderRadius.circular(999),
                  ),
                  child: Text(
                    entry.mood,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: const TextStyle(fontSize: 11, color: AppColors.accentSoft),
                  ),
                ),
              ),
            ],
          ),
          if (!entry.isOwner && entry.ownerName != null) ...[
            const SizedBox(height: 4),
            Text(
              entry.ownerName!,
              style: const TextStyle(fontSize: 12, color: AppColors.textMuted),
            ),
          ],
          const SizedBox(height: 8),
          Text(
            entry.content,
            style: const TextStyle(fontSize: 14, color: AppColors.textBody, height: 1.6),
          ),
          const SizedBox(height: 12),
          Row(
            children: [
              const Icon(Icons.location_on_rounded, size: 15, color: AppColors.accent),
              const SizedBox(width: 6),
              Expanded(
                child: Text(
                  entry.location ?? '未紀錄位置',
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(fontSize: 12, color: AppColors.textSecondary),
                ),
              ),
            ],
          ),
          const SizedBox(height: 12),
          Wrap(
            spacing: 12,
            runSpacing: 4,
            alignment: WrapAlignment.spaceBetween,
            children: [
              Text(
                createdAt != null ? formatDateTime(createdAt) : '時間未知',
                style: const TextStyle(fontSize: 12, color: AppColors.textMuted),
              ),
              if (tags.isNotEmpty)
                Text(
                  tags.map((tag) => '#$tag').join(' '),
                  style: const TextStyle(fontSize: 12, color: AppColors.accentSoft),
                ),
            ],
          ),
        ],
      ),
    );
  }

  Widget _buildJourneyTab() {
    return _buildTabList(
      children: [
        Row(
          children: [
            Expanded(
              child: Text('足跡地圖', style: Theme.of(context).textTheme.headlineMedium),
            ),
            _buildAddButton('新增足跡', const CreateFootprintScreen()),
          ],
        ),
        const SizedBox(height: 16),
        _FootprintMap(points: _locations, onFootprintsChanged: _loadData),
        const SizedBox(height: 16),
        Text('最近足跡', style: Theme.of(context).textTheme.titleLarge),
        const SizedBox(height: 12),
        if (_locations.isEmpty)
          const _EmptyMessage('還沒有足跡，按右上角的 + 記下第一趟吧')
        else
          ..._locations.map(
            (point) => Container(
              width: double.infinity,
              margin: const EdgeInsets.only(bottom: 12),
              padding: const EdgeInsets.all(16),
              decoration: AppTheme.cardDecoration,
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    point.name,
                    style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w600, color: Colors.white),
                  ),
                  if (point.note != null && point.note!.isNotEmpty) ...[
                    const SizedBox(height: 6),
                    Text(
                      point.note!,
                      style: const TextStyle(fontSize: 12, color: AppColors.textBody),
                    ),
                  ],
                  if (point.googleMapsUri case final uri?)
                    TextButton.icon(
                      style: TextButton.styleFrom(padding: EdgeInsets.zero),
                      onPressed: () => _openInGoogleMaps(uri),
                      icon: const Icon(Icons.map_outlined, size: 18),
                      label: const Text('在 Google 地圖查看'),
                    ),
                ],
              ),
            ),
          ),
      ],
    );
  }

  Future<void> _openInGoogleMaps(Uri uri) async {
    var opened = false;
    try {
      opened = await launchUrl(uri, mode: LaunchMode.externalApplication);
    } on PlatformException catch (error) {
      debugPrint('Failed to open Google Maps: $error');
    }
    if (!opened && mounted) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('無法開啟 Google 地圖')),
      );
    }
  }

  Widget _buildProfileTab() {
    final profile = _profile;

    return _buildTabList(
      children: [
        Text('我的', style: Theme.of(context).textTheme.headlineMedium),
        const SizedBox(height: 20),
        Container(
          padding: const EdgeInsets.all(20),
          decoration: AppTheme.cardDecoration,
          child: Row(
            children: [
              Container(
                width: 58,
                height: 58,
                decoration: const BoxDecoration(
                  shape: BoxShape.circle,
                  gradient: AppColors.actionGradient,
                ),
                child: const Icon(Icons.person, color: Colors.white),
              ),
              const SizedBox(width: 16),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      profile?.displayName ?? '',
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(fontSize: 20, fontWeight: FontWeight.w700, color: Colors.white),
                    ),
                    if (profile != null && profile.bio.isNotEmpty) ...[
                      const SizedBox(height: 4),
                      Text(
                        profile.bio,
                        maxLines: 2,
                        overflow: TextOverflow.ellipsis,
                        style: const TextStyle(fontSize: 13, color: AppColors.textMuted),
                      ),
                    ],
                  ],
                ),
              ),
            ],
          ),
        ),
        const SizedBox(height: 18),
        _buildMetricCard('總日記', '${_dashboard['entry_count'] ?? 0}', '篇'),
        const SizedBox(height: 14),
        _buildMetricCard('足跡', '${_locations.where((point) => point.isOwner).length}', '趟'),
        const SizedBox(height: 14),
        _buildMetricCard('追蹤者', '${profile?.followersCount ?? 0}', '人'),
        const SizedBox(height: 14),
        _buildMetricCard('追蹤中', '${profile?.followingCount ?? 0}', '人'),
        const SizedBox(height: 24),
        OutlinedButton.icon(
          onPressed: ApiService.logout,
          icon: const Icon(Icons.logout_rounded),
          label: const Text('登出'),
        ),
      ],
    );
  }

  Widget _buildMetricCard(String title, String value, String suffix) {
    return Container(
      padding: const EdgeInsets.all(18),
      decoration: AppTheme.cardDecoration,
      child: Row(
        mainAxisAlignment: MainAxisAlignment.spaceBetween,
        children: [
          Text(title, style: const TextStyle(fontSize: 16, color: AppColors.textSecondary)),
          Text.rich(
            TextSpan(
              children: [
                TextSpan(
                  text: value,
                  style: const TextStyle(fontSize: 28, fontWeight: FontWeight.w700, color: Colors.white),
                ),
                TextSpan(
                  text: ' $suffix',
                  style: const TextStyle(fontSize: 14, color: AppColors.accentSoft),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _LoadErrorView extends StatelessWidget {
  const _LoadErrorView({required this.message, required this.onRetry});

  final String message;
  final VoidCallback onRetry;

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(20),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const Icon(Icons.cloud_off_rounded, size: 40, color: AppColors.textMuted),
            const SizedBox(height: 12),
            Text(
              message,
              textAlign: TextAlign.center,
              style: const TextStyle(color: AppColors.textSecondary),
            ),
            const SizedBox(height: 16),
            FilledButton(onPressed: onRetry, child: const Text('重試')),
          ],
        ),
      ),
    );
  }
}

class _EmptyMessage extends StatelessWidget {
  const _EmptyMessage(this.message);

  final String message;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 24),
      child: Text(
        message,
        textAlign: TextAlign.center,
        style: const TextStyle(color: AppColors.textMuted),
      ),
    );
  }
}

class _FootprintMap extends StatelessWidget {
  const _FootprintMap({required this.points, required this.onFootprintsChanged});

  static const _height = 240.0;
  static const _inset = 28.0;
  static const _markerSize = 12.0;

  final List<LocationPoint> points;
  final VoidCallback onFootprintsChanged;

  @override
  Widget build(BuildContext context) {
    if (googleMapsAvailable) {
      return FootprintMapPreview(
        points: points,
        onFootprintsChanged: onFootprintsChanged,
      );
    }

    final located = points
        .where((point) => point.latitude != null && point.longitude != null)
        .toList();

    return Container(
      height: _height,
      width: double.infinity,
      clipBehavior: Clip.antiAlias,
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(28),
        gradient: AppColors.mapGradient,
      ),
      child: LayoutBuilder(
        builder: (context, constraints) {
          return Stack(
            children: [
              Positioned.fill(child: CustomPaint(painter: MapGridPainter())),
              ..._buildMarkers(located, constraints.biggest),
            ],
          );
        },
      ),
    );
  }

  /// Fits the points to the visible area; their positions are relative, not a real map.
  List<Widget> _buildMarkers(List<LocationPoint> located, Size size) {
    if (located.isEmpty) return const [];

    final latitudes = located.map((point) => point.latitude!);
    final longitudes = located.map((point) => point.longitude!);
    final minLatitude = latitudes.reduce((a, b) => a < b ? a : b);
    final maxLatitude = latitudes.reduce((a, b) => a > b ? a : b);
    final minLongitude = longitudes.reduce((a, b) => a < b ? a : b);
    final maxLongitude = longitudes.reduce((a, b) => a > b ? a : b);

    double project(double value, double min, double max, double extent) {
      final range = max - min;
      final ratio = range == 0 ? 0.5 : (value - min) / range;
      return _inset + ratio * (extent - _inset * 2) - _markerSize / 2;
    }

    return [
      for (final point in located)
        Positioned(
          left: project(point.longitude!, minLongitude, maxLongitude, size.width),
          // Latitude grows northward while screen coordinates grow downward.
          top: project(-point.latitude!, -maxLatitude, -minLatitude, size.height),
          child: Container(
            width: _markerSize,
            height: _markerSize,
            decoration: const BoxDecoration(
              color: AppColors.accent,
              shape: BoxShape.circle,
              boxShadow: [
                BoxShadow(color: AppColors.accent, blurRadius: 12),
              ],
            ),
          ),
        ),
    ];
  }
}

class MapGridPainter extends CustomPainter {
  @override
  void paint(Canvas canvas, Size size) {
    final paint = Paint()
      ..color = AppColors.outline
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
