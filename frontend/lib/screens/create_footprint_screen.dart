import 'package:flutter/material.dart';
import 'package:life_logger/services/api_service.dart';
import 'package:life_logger/services/location_service.dart';
import 'package:life_logger/theme/app_theme.dart';
import 'package:life_logger/widgets/form_section.dart';
import 'package:life_logger/widgets/privacy_selector.dart';

class _RouteStop {
  final name = TextEditingController();
  final latitude = TextEditingController();
  final longitude = TextEditingController();
  bool isLocating = false;

  void dispose() {
    name.dispose();
    latitude.dispose();
    longitude.dispose();
  }
}

class CreateFootprintScreen extends StatefulWidget {
  const CreateFootprintScreen({super.key, this.locate = currentCoordinates});

  final Future<Coordinates> Function() locate;

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
      stop.latitude.text = coordinates.latitude.toStringAsFixed(6);
      stop.longitude.text = coordinates.longitude.toStringAsFixed(6);
    } catch (error) {
      debugPrint('Failed to read location: $error');
      if (mounted) {
        _showError(
          error is LocationException ? error.message : '無法取得目前位置，請手動輸入座標',
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
              'lat': double.parse(stop.latitude.text.trim()),
              'lng': double.parse(stop.longitude.text.trim()),
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

  String? _requireText(String? value, String message) {
    if (value == null || value.trim().isEmpty) return message;
    return null;
  }

  String? _validateCoordinate(String? value, double limit, String label) {
    final coordinate = double.tryParse(value?.trim() ?? '');
    if (coordinate == null) return '請輸入$label';
    if (coordinate.abs() > limit) return '需介於 ±${limit.toInt()}';
    return null;
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
                                    _requireText(value, '請輸入足跡名稱'),
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
            hintText: '地點名稱，例如：旗津海岸',
            counterText: '',
          ),
          validator: (value) => _requireText(value, '請輸入地點名稱'),
        ),
        const SizedBox(height: 12),
        Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Expanded(
              child: _buildCoordinateField(
                stop.latitude,
                hint: '緯度',
                limit: 90,
              ),
            ),
            const SizedBox(width: 12),
            Expanded(
              child: _buildCoordinateField(
                stop.longitude,
                hint: '經度',
                limit: 180,
              ),
            ),
          ],
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

  Widget _buildCoordinateField(
    TextEditingController controller, {
    required String hint,
    required double limit,
  }) {
    return TextFormField(
      controller: controller,
      keyboardType: const TextInputType.numberWithOptions(
        decimal: true,
        signed: true,
      ),
      decoration: InputDecoration(hintText: hint),
      validator: (value) => _validateCoordinate(value, limit, hint),
    );
  }
}
