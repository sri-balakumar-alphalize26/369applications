import React, { useState, useEffect } from "react";
import {
  View,
  TouchableOpacity,
  StyleSheet,
  FlatList,
  TextInput,
  Platform,
  Dimensions,
} from "react-native";
import Modal from "react-native-modal";
import Text from "@components/Text";
import { COLORS, FONT_FAMILY } from "@constants/theme";
import { AntDesign } from "@expo/vector-icons";

const { height } = Dimensions.get("window");

const CustomListModal = ({
  items,
  onValueChange,
  isVisible,
  onAdd = () => { },
  onAddIcon = true,
  onEdit,
  onClose = () => { },
  title,
  multiSelect = false,
  previousSelections = [],
}) => {
  const [searchText, setSearchText] = useState('');
  // Multi-select: track picked items locally; commit to parent on Done.
  const [selectedItems, setSelectedItems] = useState(previousSelections || []);

  useEffect(() => {
    if (!isVisible) setSearchText('');
    if (isVisible) setSelectedItems(previousSelections || []);
  }, [isVisible, previousSelections]);

  const filteredItems = searchText.trim()
    ? (items || []).filter(item => {
        const text = (item.label || item.name || '').toLowerCase();
        return text.includes(searchText.trim().toLowerCase());
      })
    : items || [];

  const handleCustomModal = (selectedCustomData) => {
    if (multiSelect) {
      setSelectedItems((prev) => {
        const exists = (prev || []).some((p) => String(p.id) === String(selectedCustomData.id));
        if (exists) return (prev || []).filter((p) => String(p.id) !== String(selectedCustomData.id));
        return [...(prev || []), selectedCustomData];
      });
      return;
    }
    onValueChange(selectedCustomData);
    onClose();
  };

  const isSelected = (item) =>
    (selectedItems || []).some((p) => String(p.id) === String(item.id));

  const handleConfirm = () => {
    onValueChange(selectedItems || []);
    onClose();
  };
  const handleClearAll = () => setSelectedItems([]);

  return (
    <Modal
      isVisible={isVisible}
      animationIn="zoomIn"
      animationOut="zoomOut"
      backdropOpacity={0.4}
      animationInTiming={250}
      animationOutTiming={200}
      backdropTransitionInTiming={250}
      backdropTransitionOutTiming={200}
      onBackdropPress={onClose}
      onBackButtonPress={onClose}
      style={styles.modal}
    >
      <View style={styles.modalContainer}>
        {/* Header */}
        <View style={styles.header}>
          <Text style={styles.title}>{title}</Text>
          <TouchableOpacity onPress={onClose} style={styles.closeButton}>
            <AntDesign name="close" size={20} color="#666" />
          </TouchableOpacity>
        </View>

        {/* Search */}
        <View style={styles.searchWrapper}>
          <View style={styles.searchInputRow}>
            <AntDesign name="search1" size={18} color="#aaa" style={{ marginRight: 8 }} />
            <TextInput
              style={styles.searchTextInput}
              placeholder="Search..."
              placeholderTextColor="#aaa"
              value={searchText}
              onChangeText={setSearchText}
              autoCorrect={false}
            />
          </View>
        </View>

        {/* List */}
        <FlatList
          data={filteredItems}
          keyExtractor={(item, index) => String(item.id || index)}
          renderItem={({ item }) => {
            const checked = multiSelect && isSelected(item);
            return (
              <TouchableOpacity
                style={[
                  styles.listItem,
                  (onEdit || multiSelect) && { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
                ]}
                onPress={() => handleCustomModal(item)}
                activeOpacity={0.6}
              >
                <Text style={[styles.itemText, (onEdit || multiSelect) && { flex: 1 }]}>
                  {item.label || item.name || ''}
                </Text>
                {multiSelect && (
                  <AntDesign
                    name={checked ? 'checkcircle' : 'checkcircleo'}
                    size={20}
                    color={checked ? COLORS.primaryThemeColor : '#bbb'}
                  />
                )}
                {onEdit && !multiSelect && (
                  <TouchableOpacity onPress={() => onEdit(item)} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
                    <AntDesign name="edit" size={18} color={COLORS.primaryThemeColor} />
                  </TouchableOpacity>
                )}
              </TouchableOpacity>
            );
          }}
          showsVerticalScrollIndicator={false}
          ListEmptyComponent={
            <View style={styles.emptyContainer}>
              <Text style={styles.emptyText}>No results found</Text>
            </View>
          }
          contentContainerStyle={styles.listContent}
        />

        {/* Multi-select footer: Clear / Done */}
        {multiSelect && (
          <View style={styles.multiFooter}>
            <TouchableOpacity style={styles.multiBtnClear} onPress={handleClearAll} activeOpacity={0.7}>
              <Text style={styles.multiBtnClearText}>Clear</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.multiBtnDone} onPress={handleConfirm} activeOpacity={0.85}>
              <Text style={styles.multiBtnDoneText}>
                Done{(selectedItems && selectedItems.length > 0) ? ` (${selectedItems.length})` : ''}
              </Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Add button at bottom if needed (single-select only) */}
        {!multiSelect && onAddIcon && (
          <TouchableOpacity style={styles.addRow} onPress={onAdd}>
            <AntDesign name="pluscircle" size={20} color={COLORS.primaryThemeColor} />
            <Text style={styles.addRowText}>Add New</Text>
          </TouchableOpacity>
        )}
      </View>
    </Modal>
  );
};

export default CustomListModal;

export const styles = StyleSheet.create({
  modal: {
    margin: 24,
    justifyContent: "center",
    alignItems: "center",
  },
  modalContainer: {
    width: "100%",
    maxHeight: height * 0.7,
    backgroundColor: "#fff",
    borderRadius: 16,
    overflow: "hidden",
    ...Platform.select({
      android: {
        elevation: 10,
      },
      ios: {
        shadowColor: "#000",
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.25,
        shadowRadius: 12,
      },
    }),
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 18,
    paddingTop: 16,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: "#f0f0f0",
  },
  title: {
    fontSize: 18,
    fontFamily: FONT_FAMILY.urbanistBold,
    color: "#222",
    flex: 1,
  },
  closeButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: "#f2f2f2",
    alignItems: "center",
    justifyContent: "center",
  },
  searchWrapper: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: "#f0f0f0",
  },
  searchInputRow: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#f5f5f5",
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  searchTextInput: {
    flex: 1,
    fontFamily: FONT_FAMILY.urbanistRegular,
    fontSize: 14,
    color: "#333",
    padding: 0,
  },
  listContent: {
    paddingVertical: 6,
  },
  listItem: {
    paddingHorizontal: 18,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: "#f5f5f5",
  },
  itemText: {
    fontFamily: FONT_FAMILY.urbanistSemiBold,
    fontSize: 15,
    color: "#333",
  },
  emptyContainer: {
    alignItems: "center",
    paddingVertical: 30,
  },
  emptyText: {
    fontFamily: FONT_FAMILY.urbanistMedium,
    fontSize: 14,
    color: "#999",
  },
  addRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 14,
    borderTopWidth: 1,
    borderTopColor: "#f0f0f0",
  },
  addRowText: {
    fontSize: 15,
    fontFamily: FONT_FAMILY.urbanistBold,
    color: COLORS.primaryThemeColor,
    marginLeft: 8,
  },
  multiFooter: {
    flexDirection: 'row',
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 10,
    borderTopWidth: 1,
    borderTopColor: '#f0f0f0',
  },
  multiBtnClear: {
    flex: 1,
    paddingVertical: 11,
    borderRadius: 8,
    backgroundColor: '#F4F4F4',
    alignItems: 'center',
    justifyContent: 'center',
  },
  multiBtnClearText: {
    color: '#666',
    fontFamily: FONT_FAMILY.urbanistBold,
    fontSize: 13,
  },
  multiBtnDone: {
    flex: 1,
    paddingVertical: 11,
    borderRadius: 8,
    backgroundColor: COLORS.primaryThemeColor,
    alignItems: 'center',
    justifyContent: 'center',
  },
  multiBtnDoneText: {
    color: '#fff',
    fontFamily: FONT_FAMILY.urbanistBold,
    fontSize: 13,
  },
});
