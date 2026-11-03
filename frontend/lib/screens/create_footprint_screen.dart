import 'package:flutter/material.dart';
import 'package:life_logger/models/location_point.dart';
import 'package:life_logger/services/api_service.dart';
import 'package:life_logger/services/location_service.dart';
import 'package:life_logger/theme/app_theme.dart';
import 'package:life_logger/widgets/form_section.dart';
import 'package:life_logger/widgets/privacy_selector.dart';

class _RouteStop {
  final name = TextEditingController();
  // Only set when the position is known exactly; otherwise Google finds the name.
  double? latitude;
  double? longitude;
  bool isLocating = false;

  bool get isLocated => latitude != null && longitude != null;

  void clearLocation() {
    latitude = null;
    longitude = null;
  }

  void dispose() => name.dispose();
}

class CreateFootprintScreen extends StatefulWidget {
  const CreateFootprintScreen({
    super.key,
    this.locate = currentCoordinates,
    this.initialStop,
  });

  final Future<Coordinates> Function() locate;
  final RouteStop? initialStop;

  @override
  State<CreateFootprintScreen> createState() => _CreateFootprintScreenState();
}

class _CreateFootprintScreenState extends State<CreateFootprintScreen> {
  static const _maxStops = 50;

  final _formKey = GlobalKey<FormState>();
  final _nameController = TextEditingController();
  final _noteController = TextEditingController();
  final List<_RouteStop> _stops = [_RouteStop()];

  String _privacy = defaultPrivacy;
  bool _isSaving = false;

  @override
  void initState() {
    super.initState();
    final initialStop = widget.initialStop;
    if (initialStop == null) return;
    _stops.first.name.text = initialStop.name;
    _stops.first.latitude = initialStop.latitude;
    _stops.first.longitude = initialStop.longitude;
  }

  @override
  void dispose() {
    _nameController.dispose();
    _noteController.dispose();
    for (final stop in _stops) {
      stop.dispose();
    }
    super.dispose();
  }

  void _showError(String message) {
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: Text(message),
        backgroundColor: AppColors.errorSurface,
      ),
    );
  }

  void _addStop() => setState(() => _stops.add(_RouteStop()));

  void _removeStop(_RouteStop stop) {
    setState(() => _stops.remove(stop));
    stop.dispose();
  }

  Future<void> _fillCurrentLocation(_RouteStop stop) async {
    setState(() => stop.isLocating = true);
    try {
      final coordinates = await widget.locate();
      if (!mounted || !_stops.contains(stop)) return;
      stop.latitude = coordinates.latitude;
      stop.longitude = coordinates.longitude;
      if (stop.name.text.trim().isEmpty) stop.name.text = '目前位置';
    } catch (error) {
      debugPrint('Failed to read location: $error');
      if (mounted) {
        _showError(
          error is LocationException ? error.message : '無法取得目前位置，請直接輸入地點名稱或地址',
        );
      }
    } finally {
      if (mounted && _stops.contains(stop)) {
        setState(() => stop.isLocating = false);
      }
    }
  }

  Future<void> _save() async {
    if (!_formKey.currentState!.validate()) return;

    setState(() => _isSaving = true);
    try {
      await ApiService.createMapPoint({
        'name': _nameController.text.trim(),
        'note': _noteController.text.trim(),
        'privacy': _privacy,
        'points': [
          for (final (index, stop) in _stops.indexed)
            {
              if (stop.isLocated) ...{
                'lat': stop.latitude,
                'lng': stop.longitude,
              },
              'name': stop.name.text.trim(),
              'order': index + 1,
            },
        ],
      });

      if (!mounted) return;
      Navigator.of(context).pop(true);
    } catch (error) {
      if (mounted) _showError('足跡儲存失敗：$error');
    } finally {
      if (mounted) setState(() => _isSaving = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('新增足跡')),
      body: SafeArea(
        top: false,
        child: Center(
          child: ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: 640),
            child: Form(
              key: _formKey,
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  Expanded(
                    child: ListView(
                      keyboardDismissBehavior:
                          ScrollViewKeyboardDismissBehavior.onDrag,
                      padding: const EdgeInsets.fromLTRB(20, 8, 20, 8),
                      children: [
                        SectionCard(
                          children: [
                            LabeledField(
                              label: '足跡名稱',
                              child: TextFormField(
                                controller: _nameController,
                                maxLength: 160,
                                textInputAction: TextInputAction.next,
                                decoration: const InputDecoration(
                                  hintText: '例如：旗津一日散步',
                                ),
                                validator: (value) =>
                                    requireText(value, '請輸入足跡名稱'),
                              ),
                            ),
                            const SizedBox(height: 8),
                            LabeledField(
                              label: '筆記（選填）',
                              child: TextFormField(
                                controller: _noteController,
                                maxLength: 1000,
                                minLines: 2,
                                maxLines: 4,
                                decoration: const InputDecoration(
                                  hintText: '記下這裡的故事…',
                                ),
                              ),
                            ),
                          ],
                        ),
                        const SizedBox(height: 16),
                        const Text(
                          '輸入地點名稱或地址，Google 地圖會自動找到位置。名稱太籠統時可能找到同名地點，請改填完整地址。',
                          style: TextStyle(fontSize: 12, color: AppColors.textMuted),
                        ),
                        const SizedBox(height: 12),
                        for (final (index, stop) in _stops.indexed) ...[
                          _buildStopCard(index, stop),
                          const SizedBox(height: 12),
                        ],
                        if (_stops.length < _maxStops)
                          OutlinedButton.icon(
                            onPressed: _addStop,
                            icon: const Icon(Icons.add_location_alt_outlined),
                            label: const Text('新增途經點'),
                          ),
                        const SizedBox(height: 16),
                        PrivacySelector(
                          value: _privacy,
                          onChanged: (value) =>
                              setState(() => _privacy = value),
                        ),
                      ],
                    ),
                  ),
                  Padding(
                    padding: const EdgeInsets.fromLTRB(20, 8, 20, 12),
                    child: FilledButton.icon(
                      onPressed: _isSaving ? null : _save,
                      icon: _isSaving
                          ? const SizedBox.square(
                              dimension: 18,
                              child: CircularProgressIndicator(
                                strokeWidth: 2,
                                color: AppColors.textSecondary,
                              ),
                            )
                          : const Icon(Icons.bookmark_add_outlined),
                      label: Text(_isSaving ? '儲存中…' : '儲存足跡'),
                    ),
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }

  Widget _buildStopCard(int index, _RouteStop stop) {
    return SectionCard(
      key: ObjectKey(stop),
      children: [
        Row(
          children: [
            Expanded(
              child: Text(
                '第 ${index + 1} 站',
                style: Theme.of(context).textTheme.titleSmall,
              ),
            ),
            if (_stops.length > 1)
              IconButton(
                tooltip: '移除第 ${index + 1} 站',
                onPressed: () => _removeStop(stop),
                icon: const Icon(
                  Icons.close_rounded,
                  color: AppColors.textMuted,
                ),
              ),
          ],
        ),
        const SizedBox(height: 8),
        TextFormField(
          controller: stop.name,
          maxLength: 160,
          textInputAction: TextInputAction.next,
          decoration: const InputDecoration(
            hintText: '地點名稱或地址，例如：旗津海岸公園',
            counterText: '',
          ),
          onChanged: (_) {
            if (stop.isLocated) setState(stop.clearLocation);
          },
          validator: (value) => requireText(value, '請輸入地點名稱或地址'),
        ),
        if (stop.isLocated)
          const Padding(
            padding: EdgeInsets.only(top: 6),
            child: Text(
              '已定位，修改名稱後會改用名稱搜尋地點。',
              style: TextStyle(fontSize: 12, color: AppColors.textMuted),
            ),
          ),
        const SizedBox(height: 4),
        Align(
          alignment: Alignment.centerLeft,
          child: TextButton.icon(
            onPressed: stop.isLocating
                ? null
                : () => _fillCurrentLocation(stop),
            icon: const Icon(Icons.my_location_rounded, size: 18),
            label: Text(stop.isLocating ? '定位中…' : '使用目前位置'),
          ),
        ),
      ],
    );
  }
}
